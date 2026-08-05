import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import Module from "node:module"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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
  delete require.cache[require.resolve(loaderPath)]
  const loader = require(loaderPath) as (this: unknown, source: string) => void

  return new Promise<string>((resolve, reject) => {
    loader.call(
      {
        resourcePath: "/repo/src/page.tsx",
        ...extraContext,
        sourceMap: true,
        getOptions() {
          return options
        },
        async() {
          return (error: Error | null, output?: string) => {
            if (error) {
              reject(error)
              return
            }
            resolve(output ?? "")
          }
        },
      },
      'import { t } from "@palamedes/core/macro"; export function label() { return t`Hello` }'
    )
  })
}
