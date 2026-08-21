import { createRequire } from "node:module"
import Module from "node:module"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const require = createRequire(import.meta.url)
// The package ships this loader as a hand-authored CJS entrypoint, so the test
// intentionally exercises the published loader path directly.
const loaderPath = "../palamedes-po-loader.cjs"
const moduleLoader = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown
}
const originalLoad = moduleLoader._load

const loadPalamedesConfig = vi.fn()
const compileCatalogArtifactSelected = vi.fn()
const compileCatalogModule = vi.fn()
const createCatalogLoaderResult = vi.fn()
const createMissingErrorMessage = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  loadPalamedesConfig.mockResolvedValue({
    configPath: "/repo/palamedes.yaml",
    rootDir: "/repo",
    locales: ["en", "de", "pseudo"],
    sourceLocale: "en",
    pseudoLocale: "pseudo",
    fallbackLocales: undefined,
    catalogs: [{ path: "src/locales/{locale}", include: ["src"] }],
  })
  compileCatalogModule.mockReturnValue({
    code: 'export const messages={"greeting":"Hallo"};export default { messages };',
    warnings: [],
    watchFiles: ["/repo/src/locales/en.po"],
  })
  compileCatalogArtifactSelected.mockReturnValue({
    messages: { greeting: "Hallo" },
    missing: [],
    diagnostics: [],
    watchFiles: ["/repo/src/locales/de.po"],
    resolvedLocaleChain: ["de"],
  })
  createCatalogLoaderResult.mockReturnValue({
    code: 'export const messages={"greeting":"Hallo"};export default { messages };',
    warnings: [],
  })
  createMissingErrorMessage.mockReturnValue("Missing selected translation")
  vi.spyOn(console, "warn").mockImplementation(() => {})

  moduleLoader._load = (request, parent, isMain) => {
    if (request === "@palamedes/config") {
      return { loadPalamedesConfig }
    }
    if (request === "@palamedes/core-node") {
      return { compileCatalogArtifactSelected, compileCatalogModule }
    }
    if (request === "@palamedes/transform") {
      return { createCatalogLoaderResult, createMissingErrorMessage }
    }
    return originalLoad.call(Module, request, parent, isMain)
  }
})

afterEach(() => {
  moduleLoader._load = originalLoad
  vi.restoreAllMocks()
  delete require.cache[require.resolve(loaderPath)]
})

describe("palamedes-po-loader.cjs", () => {
  it("compiles a PO file into a catalog module and tracks dependencies", async () => {
    const result = await runLoader()

    expect(result.code).toBe(
      'export const messages={"greeting":"Hallo"};export default { messages };'
    )
    expect(result.dependencies).toStrictEqual(["/repo/palamedes.yaml", "/repo/src/locales/en.po"])
    expect(compileCatalogModule).toHaveBeenCalledWith(
      expect.objectContaining({ rootDir: "/repo", sourceLocale: "en" }),
      "/repo/src/locales/de.po",
      expect.objectContaining({
        locale: "de",
        pseudoLocale: "pseudo",
        failOnMissing: false,
        failOnCompileError: false,
      })
    )
  })

  it("uses the loader root context for config discovery", async () => {
    await runLoader({ cwd: "/wrong-root" }, { rootContext: "/next-app" })

    expect(loadPalamedesConfig).toHaveBeenCalledWith({
      configPath: undefined,
      cwd: "/next-app",
    })
  })

  it("fails missing translations when configured", async () => {
    compileCatalogModule.mockImplementation(() => {
      throw new Error("Missing 1 translation")
    })

    await expect(runLoader({ failOnMissing: true })).rejects.toThrow(/Missing 1 translation/)
  })

  it("routes diagnostics through webpack's emitWarning when not fatal", async () => {
    compileCatalogModule.mockReturnValue({
      code: "export const messages={};export default { messages };",
      warnings: ["Catalog diagnostics for locale de"],
      watchFiles: [],
    })
    const emitWarning = vi.fn()

    await runLoader({}, { emitWarning })

    expect(emitWarning).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("Catalog diagnostics for locale de"),
      })
    )
    expect(console.warn).not.toHaveBeenCalled()
  })

  it("fails compile diagnostics when configured", async () => {
    compileCatalogModule.mockImplementation(() => {
      throw new Error("Compilation error for 1 translation")
    })

    await expect(runLoader({ failOnCompileError: true })).rejects.toThrow(
      /Compilation error for 1 translation/
    )
    expect(console.warn).not.toHaveBeenCalled()
  })

  it("compiles only the ids encoded by a generated sidecar import", async () => {
    const selection = Buffer.from(JSON.stringify(["id-a", "id-b"])).toString("base64url")

    const result = await runLoader({}, { resourceQuery: `?palamedes-selected=${selection}` })

    expect(compileCatalogArtifactSelected).toHaveBeenCalledWith(
      expect.objectContaining({ rootDir: "/repo" }),
      "/repo/src/locales/de.po",
      ["id-a", "id-b"]
    )
    expect(createCatalogLoaderResult).toHaveBeenCalledWith(
      expect.objectContaining({ messages: { greeting: "Hallo" } }),
      expect.objectContaining({ locale: "de" })
    )
    expect(compileCatalogModule).not.toHaveBeenCalled()
    expect(result.code).toContain('"greeting":"Hallo"')
  })

  it("warns once per development compilation when a selected sidecar host cannot add dependencies", async () => {
    const selection = Buffer.from(JSON.stringify(["id-a"])).toString("base64url")
    const emitWarning = vi.fn()
    const compilation = {}
    const context = {
      _compilation: compilation,
      addDependency: undefined,
      emitWarning,
      resourceQuery: `?palamedes-selected=${selection}`,
    }

    await runLoader({}, context)
    await runLoader({}, context)

    expect(emitWarning).toHaveBeenCalledOnce()
    expect(emitWarning).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("does not implement addDependency"),
      })
    )
  })

  it("warns about selected messages missing from a non-pseudo locale", async () => {
    compileCatalogArtifactSelected.mockReturnValue({
      messages: {},
      missing: [{ sourceKey: { message: "Missing" } }],
      diagnostics: [],
      watchFiles: [],
      resolvedLocaleChain: ["de"],
    })
    const selection = Buffer.from(JSON.stringify(["id-missing"])).toString("base64url")
    const emitWarning = vi.fn()

    await runLoader({}, { resourceQuery: `?palamedes-selected=${selection}`, emitWarning })

    expect(emitWarning).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Missing selected translation" })
    )
  })
})

async function runLoader(
  options: Record<string, unknown> = {},
  extraContext: Record<string, unknown> = {}
) {
  delete require.cache[require.resolve(loaderPath)]
  const loader = require(loaderPath) as (this: unknown) => void
  const dependencies: string[] = []

  const code = await new Promise<string>((resolve, reject) => {
    const context = {
      resourcePath: "/repo/src/locales/de.po",
      async() {
        return (error: Error | null, output?: string) => {
          if (error) {
            reject(error)
            return
          }
          resolve(output ?? "")
        }
      },
      getOptions() {
        return options
      },
      addDependency(file: string) {
        dependencies.push(file)
      },
      ...extraContext,
    }

    loader.call(context)
  })

  return { code, dependencies }
}
