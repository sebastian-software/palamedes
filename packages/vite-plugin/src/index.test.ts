import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  loadPalamedesConfig: vi.fn(),
  analyzeMdxNative: vi.fn(),
  compileCatalogModule: vi.fn(),
  transformPalamedesMacros: vi.fn(),
}))

vi.mock("@palamedes/config", () => ({
  loadPalamedesConfig: mocks.loadPalamedesConfig,
}))

vi.mock("@palamedes/core-node", () => ({
  analyzeMdxNative: mocks.analyzeMdxNative,
  compileCatalogModule: mocks.compileCatalogModule,
}))

vi.mock("@palamedes/transform", () => ({
  PALAMEDES_MACRO_PACKAGES: ["@palamedes/core/macro", "@palamedes/react/macro"],
  transformPalamedesMacros: mocks.transformPalamedesMacros,
}))

import { palamedes } from "./index"

beforeEach(() => {
  mocks.loadPalamedesConfig.mockResolvedValue({
    configPath: "/repo/palamedes.yaml",
    rootDir: "/repo",
    locales: ["en", "de", "pseudo"],
    sourceLocale: "en",
    pseudoLocale: "pseudo",
    fallbackLocales: undefined,
    catalogs: [{ path: "src/locales/{locale}", include: ["src"] }],
  })
  mocks.analyzeMdxNative.mockReturnValue({
    messages: [],
    diagnostics: [],
    code: "export default function MDXContent() { return <p>Translated</p> }",
    compiledIds: ["message-id"],
    map: {
      version: 3,
      sources: ["/repo/src/guide.mdx"],
      names: [],
      mappings: "AAAA",
    },
  })
  mocks.compileCatalogModule.mockReturnValue({
    code: 'export const messages={"greeting":"Hallo"};export default { messages };',
    warnings: [],
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
    expect(mocks.compileCatalogModule).toHaveBeenCalledWith(
      expect.objectContaining({ rootDir: "/repo", sourceLocale: "en" }),
      "/repo/src/locales/de.po",
      expect.objectContaining({
        locale: "de",
        failOnMissing: false,
        failOnCompileError: false,
      })
    )
  })

  it("fails missing translations when configured", async () => {
    mocks.compileCatalogModule.mockImplementation(() => {
      throw new Error("Missing 1 translation")
    })

    await expect(runPoTransform({}, { failOnMissing: true })).rejects.toThrow(
      /Missing 1 translation/
    )
  })

  it("routes diagnostics through the plugin warning channel when not fatal", async () => {
    mocks.compileCatalogModule.mockReturnValue({
      code: "export const messages={};export default { messages };",
      warnings: ["Catalog diagnostics for locale de"],
      watchFiles: [],
    })
    const warn = vi.fn()

    await runPoTransform({ warn })

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Catalog diagnostics for locale de"))
  })

  it.each(["react", "solid"] as const)(
    "compiles MDX for the %s runtime with native source maps",
    async (framework) => {
      const addWatchFile = vi.fn()
      const result = await runMdxTransform(
        { addWatchFile },
        {
          mdx: {
            framework,
            translatableAttributes: ["alt", "title"],
            frontMatterFields: ["title"],
          },
        }
      )

      expect(result).toStrictEqual({
        code: "export default function MDXContent() { return <p>Translated</p> }",
        map: expect.objectContaining({ mappings: "AAAA" }),
      })
      expect(mocks.analyzeMdxNative).toHaveBeenCalledWith(
        "# Welcome",
        "/repo/src/guide.mdx",
        expect.objectContaining({
          framework,
          translatableAttributes: ["alt", "title"],
          frontMatterFields: ["title"],
        })
      )
      expect(addWatchFile).toHaveBeenCalledWith("/repo/palamedes.yaml")
      expect(addWatchFile).toHaveBeenCalledWith("/repo/src/locales/en.po")
    }
  )

  it("reports source-ranged MDX diagnostics through Vite", async () => {
    mocks.analyzeMdxNative.mockReturnValue({
      messages: [],
      diagnostics: [
        {
          code: "UnclosedJsxTag",
          message: "unclosed JSX tag",
          primary: { start: 10, end: 15, line: 3, column: 1 },
        },
      ],
      compiledIds: [],
    })
    const error = vi.fn((diagnostic: unknown) => {
      const message =
        typeof diagnostic === "string" ? diagnostic : (diagnostic as { message?: string }).message
      throw new Error(message)
    })

    await expect(runMdxTransform({ error })).rejects.toThrow(
      /\/repo\/src\/guide\.mdx:3:1: unclosed JSX tag \(UnclosedJsxTag\)/
    )
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "PALAMEDES_MDX",
        id: "/repo/src/guide.mdx",
        loc: { file: "/repo/src/guide.mdx", line: 3, column: 0 },
      })
    )
  })

  it("can disable first-class MDX compilation", () => {
    const plugins = palamedes({ mdx: false })
    expect(plugins.some((plugin) => plugin.name === "palamedes:mdx")).toBe(false)
    const macroTransform = plugins.find(
      (plugin) => plugin.name === "palamedes:transform"
    )?.transform
    if (typeof macroTransform !== "function") {
      throw new TypeError("Expected macro transform hook")
    }
    expect(
      macroTransform.call(
        { error: vi.fn() } as any,
        'import { Trans } from "@palamedes/react/macro"\n# Hello',
        "/repo/src/guide.mdx"
      )
    ).toBeNull()
  })

  it("invalidates compiled MDX modules when a catalog changes", async () => {
    const mdxPlugin = palamedes().find((plugin) => plugin.name === "palamedes:mdx")
    const transform = mdxPlugin?.transform
    const handleHotUpdate = mdxPlugin?.handleHotUpdate
    if (typeof transform !== "function" || typeof handleHotUpdate !== "function") {
      throw new TypeError("Expected MDX transform and HMR hooks")
    }
    await transform.call({ addWatchFile() {} } as any, "# Welcome", "/repo/src/guide.mdx")
    const module = { id: "/repo/src/guide.mdx" }
    const invalidateModule = vi.fn()

    const invalidated = await handleHotUpdate.call(
      {} as any,
      {
        file: "/repo/src/locales/de.po",
        server: {
          moduleGraph: {
            getModuleById: vi.fn().mockReturnValue(module),
            invalidateModule,
          },
        },
      } as any
    )

    expect(invalidateModule).toHaveBeenCalledWith(module)
    expect(invalidated).toStrictEqual([module])
  })

  it("runs macro lowering on compiled MDX when authored macro imports remain", () => {
    mocks.transformPalamedesMacros.mockReturnValue({
      code: "export default function Guide() { return translated }",
      hasChanged: true,
      compiledIds: ["message-id"],
      map: null,
    })
    const macroPlugin = palamedes().find((plugin) => plugin.name === "palamedes:transform")
    const transform = macroPlugin?.transform
    if (typeof transform !== "function") {
      throw new TypeError("Expected macro transform hook")
    }
    const code =
      'import { Trans } from "@palamedes/react/macro"\nexport default <Trans>Hello</Trans>'

    const result = transform.call({ error: vi.fn() } as any, code, "/repo/src/guide.mdx")

    expect(mocks.transformPalamedesMacros).toHaveBeenCalledWith(
      code,
      "/repo/src/guide.mdx",
      expect.any(Object)
    )
    expect(result).toMatchObject({ code: expect.stringContaining("translated") })
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

async function runMdxTransform(
  context: Record<string, unknown> = {},
  options: Parameters<typeof palamedes>[0] = {}
) {
  const mdxPlugin = palamedes(options).find((plugin) => plugin.name === "palamedes:mdx")
  const transform = mdxPlugin?.transform

  if (typeof transform !== "function") {
    throw new TypeError("Expected palamedes:mdx transform hook")
  }

  return transform.call(
    {
      addWatchFile() {},
      ...context,
    } as any,
    "# Welcome",
    "/repo/src/guide.mdx"
  )
}
