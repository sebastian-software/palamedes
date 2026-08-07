import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import Module from "node:module"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

declare global {
  var __pmds_test_body_ran: boolean | undefined
  var __pmds_test_getI18n: (() => { _: (message: string) => string }) | undefined
  var __pmds_test_label: string | undefined
}

const require = createRequire(import.meta.url)
const loaderPath = "../palamedes-loader.cjs"
const moduleLoader = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown
}
const originalLoad = moduleLoader._load
const transformPalamedesMacros = vi.fn()
const loadPalamedesConfigSync = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  transformPalamedesMacros.mockReturnValue({
    code: "export const translated = true",
    map: null,
    compiledIds: [],
  })
  loadPalamedesConfigSync.mockReturnValue({
    configPath: "/repo/palamedes.yaml",
    rootDir: "/repo",
    locales: ["en", "de"],
    sourceLocale: "en",
    catalogs: [{ path: "src/locales/{locale}", include: ["src/**/*.tsx"] }],
  })
  moduleLoader._load = (request, parent, isMain) => {
    if (request === "@palamedes/transform") {
      return { transformPalamedesMacros }
    }
    if (request === "@palamedes/config") {
      return { loadPalamedesConfigSync }
    }
    return originalLoad.call(Module, request, parent, isMain)
  }
})

afterEach(() => {
  moduleLoader._load = originalLoad
  vi.restoreAllMocks()
  delete require.cache[require.resolve(loaderPath)]
})

describe("palamedes-loader.cjs", () => {
  it("forwards the source fallback policy to the native transform", async () => {
    const output = await runLoader({
      runtimeModule: "@acme/custom-runtime",
      keepSourceFallbacks: false,
      stripNonEssentialProps: true,
      serverFunctions: {
        initializerModule: "@/i18n/server-action",
        initializerExport: "initServerActionI18n",
      },
    })

    expect(output).toBe("export const translated = true")
    expect(transformPalamedesMacros).toHaveBeenCalledWith(
      expect.any(String),
      "/repo/src/page.tsx",
      expect.objectContaining({
        runtimeModule: "@acme/custom-runtime",
        keepSourceFallbacks: false,
        stripNonEssentialProps: true,
        serverFunctions: {
          initializerModule: "@/i18n/server-action",
          initializerExport: "initServerActionI18n",
        },
      })
    )
  })

  it("registers active-locale imports for a server module's compiled ids", async () => {
    transformPalamedesMacros.mockReturnValue({
      code: "export const translated = true",
      map: null,
      compiledIds: ["id-a", "id-b"],
    })
    const dependencies: string[] = []

    const output = await runLoader(
      { serverMessageSplitting: true },
      { addDependency: (file: string) => dependencies.push(file) }
    )

    expect(output).toContain('import { registerMessageLoaders } from "@palamedes/runtime";')
    expect(output).toContain('"en": () => import("./locales/en.po?palamedes-selected=')
    expect(output).toContain('"de": () => import("./locales/de.po?palamedes-selected=')
    expect(output).toContain(".then(({ messages }) => messages)")
    expect(dependencies).toEqual(["/repo/palamedes.yaml"])
  })

  it("blocks a client module on only the document locale's compiled fragments", async () => {
    transformPalamedesMacros.mockReturnValue({
      code: "export const translated = true",
      map: null,
      compiledIds: ["id-a", "id-b"],
    })

    const output = await runLoader({ clientMessageSplitting: true })

    expect(output).toContain("_locale = document.documentElement.lang")
    expect(output).toContain("_modules = await Promise.all")
    expect(output).toContain('"en": () => import("./locales/en.po?palamedes-selected=')
    expect(output).toContain('"de": () => import("./locales/de.po?palamedes-selected=')
    expect(output).toContain(".initializeClientI18n(")
    expect(output).toContain("_i18n.load(")
    expect(output).not.toContain("registerMessageLoaders")
  })

  it("boots a client module before its compiled module-scope call and its importers", async () => {
    transformPalamedesMacros.mockReturnValue({
      code: [
        '"use client";',
        'const label = globalThis.__pmds_test_getI18n()._("module label");',
        "globalThis.__pmds_test_label = label;",
      ].join("\n"),
      map: null,
      compiledIds: ["id-a"],
    })

    const originalDocument = globalThis.document
    const originalGetI18n = globalThis.__pmds_test_getI18n
    const originalLabel = globalThis.__pmds_test_label
    const requested: string[] = []
    const loaded: Array<{ locale: string; messages: Record<string, unknown> }> = []
    let moduleBodyRan = false
    let resolveFragment: (value: { messages: Record<string, unknown> }) => void = () => {
      throw new Error("Fragment resolver was not initialized")
    }
    const fragment = new Promise<{ messages: Record<string, unknown> }>((resolve) => {
      resolveFragment = resolve
    })
    const i18n = {
      load(locale: string, messages: Record<string, unknown>) {
        loaded.push({ locale, messages })
      },
      _(message: string) {
        moduleBodyRan = true
        if (loaded.length !== 1 || loaded[0]?.locale !== "de") {
          throw new Error("No active client i18n instance")
        }
        return `${message} translated`
      },
    }

    try {
      globalThis.document = { documentElement: { lang: "de" } } as Document
      globalThis.__pmds_test_getI18n = () => i18n

      const output = await runLoader({ clientMessageSplitting: true })
      expect(output.indexOf("_modules = await Promise.all")).toBeLessThan(
        output.indexOf("const label =")
      )
      expect(output.startsWith('"use client";')).toBe(true)

      const modulePromise = executeGeneratedClientModule(output, async (specifier) => {
        requested.push(specifier)
        if (specifier === "@palamedes/core/compiled") {
          return { createI18n: () => i18n }
        }
        if (specifier === "@palamedes/runtime") {
          return { initializeClientI18n: () => i18n }
        }
        if (specifier.includes("./locales/de.po?palamedes-selected=")) {
          return fragment
        }
        throw new Error(`Unexpected import: ${specifier}`)
      })
      const importer = modulePromise.then(() => globalThis.__pmds_test_label)

      await Promise.resolve()
      expect(moduleBodyRan).toBe(false)
      expect(requested).toHaveLength(3)
      expect(requested.some((specifier) => specifier.includes("./locales/en.po"))).toBe(false)

      resolveFragment({ messages: { id: "translated" } })

      await expect(importer).resolves.toBe("module label translated")
      expect(loaded).toEqual([{ locale: "de", messages: { id: "translated" } }])
    } finally {
      restoreGlobal("document", originalDocument)
      restoreGlobal("__pmds_test_getI18n", originalGetI18n)
      restoreGlobal("__pmds_test_label", originalLabel)
    }
  })

  it("propagates client bootstrap rejections to importers before evaluating the module body", async () => {
    transformPalamedesMacros.mockReturnValue({
      code: "globalThis.__pmds_test_body_ran = true;",
      map: null,
      compiledIds: ["id-a"],
    })

    const originalDocument = globalThis.document
    const originalBodyRan = globalThis.__pmds_test_body_ran
    const bootstrapError = new Error("fragment failed to load")

    try {
      globalThis.document = { documentElement: { lang: "de" } } as Document

      const output = await runLoader({ clientMessageSplitting: true })
      const modulePromise = executeGeneratedClientModule(output, async (specifier) => {
        if (specifier === "@palamedes/core/compiled") {
          return { createI18n: () => ({}) }
        }
        if (specifier === "@palamedes/runtime") {
          return { initializeClientI18n: () => ({}) }
        }
        if (specifier.includes("./locales/de.po?palamedes-selected=")) {
          throw bootstrapError
        }
        throw new Error(`Unexpected import: ${specifier}`)
      })

      await expect(modulePromise.then(() => "importer resolved")).rejects.toBe(bootstrapError)
      expect(globalThis.__pmds_test_body_ran).toBeUndefined()
    } finally {
      restoreGlobal("document", originalDocument)
      restoreGlobal("__pmds_test_body_ran", originalBodyRan)
    }
  })

  it("keeps transformed source-map lines aligned after the client bootstrap", async () => {
    transformPalamedesMacros.mockReturnValue({
      code: ['"use client";', 'const label = getI18n()._("Hello");'].join("\n"),
      map: {
        version: 3,
        sources: ["page.tsx"],
        names: [],
        mappings: "AAAA;AACA",
      },
      compiledIds: ["id-a"],
    })

    const output = await runLoaderResult({ clientMessageSplitting: true })
    const bodyLine = output.code.split("\n").findIndex((line) => line.startsWith("const label ="))
    const mappings = (output.map as { mappings: string }).mappings.split(";")

    expect(bodyLine).toBeGreaterThan(1)
    expect(mappings[0]).toBe("AAAA")
    expect(mappings.slice(1, bodyLine)).toEqual(Array.from({ length: bodyLine - 1 }, () => ""))
    expect(mappings[bodyLine]).toBe("AACA")
  })

  it("does not add server message imports to a client transform", async () => {
    transformPalamedesMacros.mockReturnValue({
      code: "export const translated = true",
      map: null,
      compiledIds: ["id-a"],
    })

    const output = await runLoader({ serverMessageSplitting: false })

    expect(output).not.toContain("registerMessageLoaders")
    expect(loadPalamedesConfigSync).not.toHaveBeenCalled()
  })

  it("skips server splitting when the transform does not report compiled ids", async () => {
    transformPalamedesMacros.mockReturnValue({
      code: "export const translated = true",
      map: null,
    })

    const output = await runLoader({ serverMessageSplitting: true })

    expect(output).toBe("export const translated = true")
    expect(loadPalamedesConfigSync).not.toHaveBeenCalled()
  })

  it("matches catalogs when the configured root resolves through a symlink", async () => {
    const fixtureDirectory = await mkdtemp(path.join(os.tmpdir(), "palamedes-next-loader-"))
    const realRoot = path.join(fixtureDirectory, "real-root")
    const linkedRoot = path.join(fixtureDirectory, "linked-root")
    const resourcePath = path.join(realRoot, "src", "page.tsx")

    try {
      await mkdir(path.dirname(resourcePath), { recursive: true })
      await writeFile(resourcePath, "")
      await symlink(realRoot, linkedRoot, process.platform === "win32" ? "junction" : "dir")
      transformPalamedesMacros.mockReturnValue({
        code: "export const translated = true",
        map: null,
        compiledIds: ["id-a"],
      })
      loadPalamedesConfigSync.mockReturnValue({
        configPath: path.join(linkedRoot, "palamedes.yaml"),
        rootDir: linkedRoot,
        locales: ["en"],
        sourceLocale: "en",
        catalogs: [{ path: "src/locales/{locale}", include: ["src/**/*.tsx"] }],
      })
      const warnings: Error[] = []

      const output = await runLoader(
        { serverMessageSplitting: true },
        {
          resourcePath,
          emitWarning: (warning: Error) => warnings.push(warning),
        }
      )

      expect(output).toContain('import { registerMessageLoaders } from "@palamedes/runtime";')
      expect(warnings).toEqual([])
    } finally {
      await rm(fixtureDirectory, { force: true, recursive: true })
    }
  })

  it("rejects server splitting for catalog formats without a Next loader", async () => {
    transformPalamedesMacros.mockReturnValue({
      code: "export const translated = true",
      map: null,
      compiledIds: ["id-a"],
    })
    loadPalamedesConfigSync.mockReturnValue({
      configPath: "/repo/palamedes.yaml",
      rootDir: "/repo",
      locales: ["en"],
      sourceLocale: "en",
      catalogs: [
        {
          path: "src/locales/{locale}",
          include: ["src/**/*.tsx"],
          format: "fcl",
        },
      ],
    })

    await expect(runLoader({ serverMessageSplitting: true })).rejects.toThrow(
      "Palamedes Next message splitting currently supports PO catalogs only"
    )
  })
})

async function runLoader(
  options: Record<string, unknown>,
  extraContext: Record<string, unknown> = {}
): Promise<string> {
  const output = await runLoaderResult(options, extraContext)
  return output.code
}

async function runLoaderResult(
  options: Record<string, unknown>,
  extraContext: Record<string, unknown> = {}
): Promise<{ code: string; map: unknown }> {
  delete require.cache[require.resolve(loaderPath)]
  const loader = require(loaderPath) as (this: unknown, source: string) => void

  return new Promise<{ code: string; map: unknown }>((resolve, reject) => {
    loader.call(
      {
        resourcePath: "/repo/src/page.tsx",
        ...extraContext,
        sourceMap: true,
        getOptions() {
          return options
        },
        async() {
          return (error: Error | null, output?: string, sourceMap?: unknown) => {
            if (error) {
              reject(error)
              return
            }
            resolve({ code: output ?? "", map: sourceMap })
          }
        },
      },
      'import { t } from "@palamedes/core/macro"; export function label() { return t`Hello` }'
    )
  })
}

function executeGeneratedClientModule(
  code: string,
  importModule: (specifier: string) => Promise<unknown>
): Promise<unknown> {
  // This executes generated top-level-await code without a bundler-specific harness.
  // eslint-disable-next-line no-new-func
  const execute = new Function(
    "__import",
    `return (async () => { ${code.replaceAll("import(", "__import(")} })()`
  ) as (load: (specifier: string) => Promise<unknown>) => Promise<unknown>

  return execute(importModule)
}

function restoreGlobal(key: string, value: unknown): void {
  if (value === undefined) {
    delete (globalThis as Record<string, unknown>)[key]
    return
  }
  ;(globalThis as Record<string, unknown>)[key] = value
}
