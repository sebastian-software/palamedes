import { createRequire } from "node:module"
import Module from "node:module"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const require = createRequire(import.meta.url)
const loaderPath = "../palamedes-po-loader.cjs"
const moduleLoader = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown
}
const originalLoad = moduleLoader._load

const loadPalamedesConfig = vi.fn()
const compileCatalogArtifact = vi.fn()

beforeEach(() => {
  loadPalamedesConfig.mockResolvedValue({
    rootDir: "/repo",
    locales: ["en", "de", "pseudo"],
    sourceLocale: "en",
    pseudoLocale: "pseudo",
    fallbackLocales: undefined,
    catalogs: [{ path: "src/locales/{locale}", include: ["src"] }],
  })
  compileCatalogArtifact.mockReturnValue({
    messages: { greeting: "Hallo" },
    missing: [],
    diagnostics: [],
    watchFiles: ["/repo/src/locales/en.po"],
  })
  vi.spyOn(console, "warn").mockImplementation(() => undefined)

  moduleLoader._load = (request, parent, isMain) => {
    if (request === "@palamedes/config") {
      return { loadPalamedesConfig }
    }
    if (request === "@palamedes/core-node") {
      return { compileCatalogArtifact }
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

    expect(result.code).toBe('export const messages={"greeting":"Hallo"};export default { messages };')
    expect(result.dependencies).toEqual(["/repo/src/locales/en.po"])
    expect(compileCatalogArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ rootDir: "/repo", sourceLocale: "en" }),
      "/repo/src/locales/de.po"
    )
  })

  it("fails missing translations when configured", async () => {
    compileCatalogArtifact.mockReturnValue({
      messages: {},
      missing: [{ sourceKey: { message: "Hello" } }],
      diagnostics: [],
      watchFiles: [],
    })

    await expect(runLoader({ failOnMissing: true })).rejects.toThrow(
      /Missing 1 translation/
    )
  })

  it("warns diagnostics when compile errors are not fatal", async () => {
    compileCatalogArtifact.mockReturnValue({
      messages: {},
      missing: [],
      diagnostics: [
        {
          severity: "error",
          code: "icu.missing_argument",
          message: "Missing argument",
          sourceKey: { message: "Hello {name}" },
          locale: "de",
        },
      ],
      watchFiles: [],
    })

    await runLoader()

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Catalog diagnostics for locale de"))
  })
})

async function runLoader(options: Record<string, unknown> = {}) {
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
    }

    loader.call(context)
  })

  return { code, dependencies }
}
