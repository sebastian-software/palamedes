import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  loadPalamedesConfig: vi.fn(),
  compileCatalogArtifact: vi.fn(),
  transformPalamedesMacros: vi.fn(),
}))

vi.mock("@palamedes/config", () => ({
  loadPalamedesConfig: mocks.loadPalamedesConfig,
}))

vi.mock("@palamedes/core-node", () => ({
  compileCatalogArtifact: mocks.compileCatalogArtifact,
}))

vi.mock("@palamedes/transform", () => ({
  PALAMEDES_MACRO_PACKAGES: ["@palamedes/core/macro", "@palamedes/react/macro"],
  transformPalamedesMacros: mocks.transformPalamedesMacros,
}))

import { palamedes } from "./index"

beforeEach(() => {
  mocks.loadPalamedesConfig.mockResolvedValue({
    rootDir: "/repo",
    locales: ["en", "de", "pseudo"],
    sourceLocale: "en",
    pseudoLocale: "pseudo",
    fallbackLocales: undefined,
    catalogs: [{ path: "src/locales/{locale}", include: ["src"] }],
  })
  mocks.compileCatalogArtifact.mockReturnValue({
    messages: { greeting: "Hallo" },
    missing: [],
    diagnostics: [],
    watchFiles: ["/repo/src/locales/en.po"],
  })
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("palamedes vite plugin", () => {
  it("compiles PO files and registers watch dependencies", async () => {
    const addWatchFile = vi.fn()
    const result = await runPoTransform({ addWatchFile })

    expect(result).toStrictEqual({
      code: 'export const messages={"greeting":"Hallo"};export default { messages };',
      map: null,
    })
    expect(addWatchFile).toHaveBeenCalledWith("/repo/src/locales/en.po")
    expect(mocks.compileCatalogArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ rootDir: "/repo", sourceLocale: "en" }),
      "/repo/src/locales/de.po"
    )
  })

  it("fails missing translations when configured", async () => {
    mocks.compileCatalogArtifact.mockReturnValue({
      messages: {},
      missing: [{ sourceKey: { message: "Hello" } }],
      diagnostics: [],
      watchFiles: [],
    })

    await expect(runPoTransform({}, { failOnMissing: true })).rejects.toThrow(
      /Missing 1 translation/
    )
  })

  it("warns diagnostics when compile errors are not fatal", async () => {
    mocks.compileCatalogArtifact.mockReturnValue({
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

    await runPoTransform()

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Catalog diagnostics for locale de")
    )
  })
})

async function runPoTransform(
  context: Record<string, unknown> = {},
  options: Parameters<typeof palamedes>[0] = {}
) {
  const plugins = palamedes(options)
  const poLoader = plugins.find((plugin) => plugin.name === "palamedes:po-loader")
  const transform = poLoader?.transform

  if (typeof transform !== "function") {
    throw new TypeError("Expected palamedes:po-loader transform hook")
  }

  return transform.call(
    {
      addWatchFile() {},
      ...context,
    } as any,
    "",
    "/repo/src/locales/de.po"
  )
}
