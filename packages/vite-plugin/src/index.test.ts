import { beforeEach, describe, expect, it, vi } from "vitest"

import type * as PalamedesTransformModule from "@palamedes/transform"

const mocks = vi.hoisted(() => ({
  loadPalamedesConfig: vi.fn(),
  analyzeMdxNative: vi.fn(),
  compileCatalogArtifactSelected: vi.fn(),
  compileCatalogModule: vi.fn(),
  createMissingErrorMessage: vi.fn(),
  renderCatalogModule: vi.fn(),
  transformPalamedesMacros: vi.fn(),
}))

vi.mock("@palamedes/config", () => ({
  loadPalamedesConfig: mocks.loadPalamedesConfig,
}))

vi.mock("@palamedes/core-node", () => ({
  analyzeMdxNative: mocks.analyzeMdxNative,
  compileCatalogArtifactSelected: mocks.compileCatalogArtifactSelected,
  compileCatalogModule: mocks.compileCatalogModule,
  renderCatalogModule: mocks.renderCatalogModule,
}))

vi.mock("@palamedes/transform", async (importOriginal) => {
  // Framework resolution is pure and shared across plugins — exercise the real
  // implementation so these tests pin the derived defaults, not a stub.
  const actual = await importOriginal<typeof PalamedesTransformModule>()
  return {
    PALAMEDES_MACRO_PACKAGES: ["@palamedes/core/macro", "@palamedes/react/macro"],
    createMissingErrorMessage: mocks.createMissingErrorMessage,
    transformPalamedesMacros: mocks.transformPalamedesMacros,
    resolveMacroRuntimeModule: actual.resolveMacroRuntimeModule,
    mdxFrameworkFor: actual.mdxFrameworkFor,
  }
})

import { palamedes } from "./index"

beforeEach(() => {
  mocks.loadPalamedesConfig.mockResolvedValue({
    configPath: "/repo/palamedes.yaml",
    rootDir: "/repo",
    locales: ["en", "de", "pseudo"],
    sourceLocale: "en",
    pseudoLocale: "pseudo",
    fallbackLocales: undefined,
    catalogs: [{ path: "src/locales/{locale}", include: ["src/**/*"] }],
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
  mocks.compileCatalogArtifactSelected.mockReturnValue({
    messages: {},
    missing: [],
    diagnostics: [],
    watchFiles: ["/repo/src/locales/de.po", "/repo/src/locales/en.po"],
    resolvedLocaleChain: ["de", "en"],
  })
  mocks.createMissingErrorMessage.mockImplementation(
    (locale: string, missing: unknown[]) =>
      `Missing ${missing.length} translation(s) for locale ${locale}`
  )
  mocks.renderCatalogModule.mockImplementation(
    (messages: Record<string, string>) =>
      `/*rendered*/export const messages=${JSON.stringify(messages)};export default { messages };`
  )
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
        ...(framework === "react" ? { moduleType: "jsx" } : {}),
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
    }
  )

  it("keeps the macro runtime module out of MDX options", async () => {
    mocks.analyzeMdxNative.mockClear()
    await runMdxTransform({}, { runtimeModule: "@acme/macro-runtime" })

    /*
     * The macro option is an opt-in that swaps a framework-agnostic default for
     * a reactive one. MDX already defaults to the framework's reactive runtime,
     * so inheriting the macro target would silently downgrade it.
     */
    const mdxOptions = mocks.analyzeMdxNative.mock.calls[0]?.[2] as
      | Record<string, unknown>
      | undefined
    expect(mdxOptions).toBeDefined()
    expect(mdxOptions).not.toHaveProperty("runtimeModule")
  })

  it("lets MDX configuration set its own runtime module", async () => {
    await runMdxTransform(
      {},
      {
        runtimeModule: "@acme/macro-runtime",
        mdx: { runtimeModule: "@acme/mdx-runtime" },
      }
    )

    expect(mocks.analyzeMdxNative).toHaveBeenCalledWith(
      "# Welcome",
      "/repo/src/guide.mdx",
      expect.objectContaining({ runtimeModule: "@acme/mdx-runtime" })
    )
  })

  it("validates compiled MDX IDs when failOnMissing is enabled", async () => {
    mocks.compileCatalogArtifactSelected.mockReturnValueOnce({
      messages: {},
      missing: [{ sourceKey: { message: "Welcome" } }],
      diagnostics: [],
      watchFiles: ["/repo/src/locales/de.po", "/repo/src/locales/en.po"],
      resolvedLocaleChain: ["de", "en"],
    })

    await expect(runMdxTransform({}, { failOnMissing: true })).rejects.toThrow(
      /Missing 1 translation.*failOnMissing=true/s
    )
    expect(mocks.compileCatalogArtifactSelected).toHaveBeenCalledWith(
      expect.objectContaining({
        catalogs: [{ path: "src/locales/{locale}", include: ["src/**/*"] }],
      }),
      "/repo/src/locales/de.po",
      ["message-id"]
    )
  })

  it("configures JSX module parsing only for React MDX", async () => {
    await expect(runMdxConfig()).resolves.toMatchObject({
      build: {
        rollupOptions: {
          moduleTypes: {
            ".mdx": "jsx",
          },
        },
      },
    })
    await expect(runMdxConfig({ mdx: { framework: "solid" } })).resolves.toBeUndefined()
  })

  it("does not require an auto-discovered config during Vite startup", async () => {
    mocks.loadPalamedesConfig.mockRejectedValueOnce(
      new Error("Could not find a Palamedes config. Expected one of palamedes.yaml.")
    )

    await expect(runMdxConfig()).resolves.toBeUndefined()
  })

  it("does not hide config errors other than missing auto-discovery", async () => {
    mocks.loadPalamedesConfig.mockRejectedValueOnce(new Error("Invalid Palamedes config"))

    await expect(runMdxConfig()).rejects.toThrow("Invalid Palamedes config")
  })

  it("still requires a config when an MDX module is transformed", async () => {
    mocks.loadPalamedesConfig.mockRejectedValueOnce(
      new Error("Could not find a Palamedes config. Expected one of palamedes.yaml.")
    )

    await expect(runMdxTransform()).rejects.toThrow("Could not find a Palamedes config")
  })

  it("does not let the JavaScript include filter disable MDX", async () => {
    await expect(runMdxTransform({}, { include: "src/**/*.ts" })).resolves.toMatchObject({
      moduleType: "jsx",
    })
  })

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

  it("invalidates compiled MDX modules when the Palamedes config changes", async () => {
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
        file: "/repo/palamedes.yaml",
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

  it.each([
    ["react", undefined, "@palamedes/react/runtime"],
    ["solid", "solid", "@palamedes/solid/runtime"],
    ["none", "none", "@palamedes/runtime"],
  ] as const)(
    "derives the macro runtime module for %s",
    (_label, framework, expectedRuntimeModule) => {
      runMacroTransform(framework === undefined ? {} : { framework })

      expect(mocks.transformPalamedesMacros).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ runtimeModule: expectedRuntimeModule })
      )
    }
  )

  it("lets an explicit runtime module override the framework default", () => {
    runMacroTransform({ framework: "react", runtimeModule: "@acme/custom-runtime" })

    expect(mocks.transformPalamedesMacros).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ runtimeModule: "@acme/custom-runtime" })
    )
  })

  it.each([
    ["build", false, true],
    ["serve", true, false],
  ] as const)(
    "sets runtime fallback metadata for Vite %s",
    (command, expectedFallbacks, expectedMetadataStrip) => {
      runMacroTransform({}, command)

      expect(mocks.transformPalamedesMacros).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          keepSourceFallbacks: expectedFallbacks,
          stripNonEssentialProps: expectedMetadataStrip,
        })
      )
    }
  )

  it("lets keepSourceFallbacks override the Vite command default", () => {
    runMacroTransform({ keepSourceFallbacks: true }, "build")

    expect(mocks.transformPalamedesMacros).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ keepSourceFallbacks: true })
    )
  })

  it("applies the source fallback mode to compiled MDX", async () => {
    await runMdxTransform({}, {}, "serve")

    expect(mocks.analyzeMdxNative).toHaveBeenCalledWith(
      "# Welcome",
      "/repo/src/guide.mdx",
      expect.objectContaining({ keepSourceFallbacks: true })
    )
  })

  it("seeds MDX options from the framework option", async () => {
    mocks.analyzeMdxNative.mockClear()
    await runMdxTransform({}, { framework: "solid" })

    expect(mocks.analyzeMdxNative).toHaveBeenCalledWith(
      "# Welcome",
      "/repo/src/guide.mdx",
      expect.objectContaining({ framework: "solid" })
    )
  })

  it("lets MDX configuration override the framework option", async () => {
    mocks.analyzeMdxNative.mockClear()
    await runMdxTransform({}, { framework: "solid", mdx: { framework: "react" } })

    expect(mocks.analyzeMdxNative).toHaveBeenCalledWith(
      "# Welcome",
      "/repo/src/guide.mdx",
      expect.objectContaining({ framework: "react" })
    )
  })
})

describe("experimental graph splitting", () => {
  it("appends a sidecar import to modules that reference messages", async () => {
    const result = (await runMacroTransform({ experimentalGraphSplitting: true }, undefined, [
      "id-a",
      "id-b",
    ])) as { code?: string } | null

    expect(result?.code).toMatch(
      /^transformed\nimport "virtual:palamedes-messages\/[0-9a-f]{12}";\n$/
    )
  })

  it("leaves modules without message references untouched", async () => {
    const result = (await runMacroTransform(
      { experimentalGraphSplitting: true },
      undefined,
      []
    )) as { code?: string } | null

    expect(result?.code).toBe("transformed")
  })

  it("does not append sidecar imports when the flag is off", async () => {
    const result = (await runMacroTransform({}, undefined, ["id-a"])) as { code?: string } | null

    expect(result?.code).toBe("transformed")
  })

  it("aggregates branded per-locale modules into one registration, skipping pseudo", async () => {
    const { load, key } = await runSidecarLoad(["id-a"])
    const result = await load(`\0palamedes:messages/${key}`)

    expect(result?.code).toBe(
      `import { messages as m0 } from "virtual:palamedes-messages/${key}/en";\n` +
        `import { messages as m1 } from "virtual:palamedes-messages/${key}/de";\n` +
        `import { registerMessages } from "@palamedes/runtime";\n` +
        `registerMessages({ "en": m0, "de": m1 });\n`
    )
    expect(result?.moduleSideEffects).toBe(true)
    // Message compilation happens in the per-locale modules, not the aggregator.
    expect(mocks.compileCatalogArtifactSelected).not.toHaveBeenCalled()
  })

  it("renders per-locale modules through the native catalog renderer", async () => {
    mocks.compileCatalogArtifactSelected.mockImplementation(
      (_config: unknown, resourcePath: string) => ({
        messages:
          resourcePath === "/repo/src/locales/de.po" ? { "id-a": "Hallo" } : { "id-a": "Hello" },
        missing: [],
        diagnostics: [],
        watchFiles: [resourcePath],
        resolvedLocaleChain: [],
      })
    )

    const { load, key, addWatchFile } = await runSidecarLoad(["id-a"])
    const result = await load(`\0palamedes:messages/${key}/de`)

    expect(mocks.compileCatalogArtifactSelected).toHaveBeenCalledTimes(1)
    expect(mocks.compileCatalogArtifactSelected).toHaveBeenCalledWith(
      expect.objectContaining({ rootDir: "/repo" }),
      "/repo/src/locales/de.po",
      ["id-a"]
    )
    expect(mocks.renderCatalogModule).toHaveBeenCalledWith({ "id-a": "Hallo" })
    expect(result?.code).toBe(
      `/*rendered*/export const messages={"id-a":"Hallo"};export default { messages };`
    )
    expect(addWatchFile).toHaveBeenCalledWith("/repo/src/locales/de.po")
  })

  it("warns on missing translations and keeps the sidecar buildable", async () => {
    mocks.compileCatalogArtifactSelected.mockReturnValue({
      messages: {},
      missing: [{ id: "id-a", message: "Hello" }],
      diagnostics: [],
      watchFiles: [],
      resolvedLocaleChain: [],
    })

    const warn = vi.fn()
    const { load, key } = await runSidecarLoad(["id-a"], { warn })
    const result = await load(`\0palamedes:messages/${key}/de`)

    expect(result?.code).toContain("export const messages")
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("/repo/src/label.ts"))
  })
})

async function runSidecarLoad(
  compiledIds: string[],
  context: Record<string, unknown> = {}
): Promise<{
  load: (id: string) => Promise<any>
  key: string
  addWatchFile: ReturnType<typeof vi.fn>
}> {
  mocks.transformPalamedesMacros.mockClear()
  mocks.compileCatalogArtifactSelected.mockClear()
  mocks.renderCatalogModule.mockClear()
  mocks.transformPalamedesMacros.mockReturnValue({
    code: "transformed",
    hasChanged: true,
    compiledIds,
    map: null,
  })
  const plugins = palamedes({ experimentalGraphSplitting: true })
  const macroPlugin = plugins.find((plugin) => plugin.name === "palamedes:transform")
  const sidecarPlugin = plugins.find((plugin) => plugin.name === "palamedes:message-sidecars")
  const transform = macroPlugin?.transform
  const load = sidecarPlugin?.load
  if (typeof transform !== "function" || typeof load !== "function") {
    throw new TypeError("Expected transform and sidecar load hooks")
  }

  const transformed = (await transform.call(
    { error: vi.fn() } as never,
    'import { t } from "@palamedes/core/macro"\nexport const label = t`Hello`',
    "/repo/src/label.ts"
  )) as { code?: string } | null
  const key = /virtual:palamedes-messages\/([0-9a-f]{12})/.exec(transformed?.code ?? "")?.[1]
  if (!key) {
    throw new Error("Expected a sidecar import in the transformed output")
  }

  const addWatchFile = vi.fn()
  const boundLoad = (id: string) =>
    Promise.resolve(
      load.call(
        {
          addWatchFile,
          error(message: unknown) {
            throw message instanceof Error ? message : new Error(String(message))
          },
          warn() {},
          ...context,
        } as any,
        id
      )
    )

  return { load: boundLoad, key, addWatchFile }
}

function runMacroTransform(
  options: Parameters<typeof palamedes>[0] = {},
  command?: "build" | "serve",
  compiledIds: string[] = []
) {
  mocks.transformPalamedesMacros.mockClear()
  mocks.transformPalamedesMacros.mockReturnValue({
    code: "transformed",
    hasChanged: true,
    compiledIds,
    map: null,
  })
  const macroPlugin = palamedes(options).find((plugin) => plugin.name === "palamedes:transform")
  const transform = macroPlugin?.transform

  if (command && typeof macroPlugin?.config === "function") {
    macroPlugin.config.call(
      {} as any,
      {} as any,
      { command, mode: command === "serve" ? "development" : "production" } as any
    )
  }

  if (typeof transform !== "function") {
    throw new TypeError("Expected macro transform hook")
  }

  return transform.call(
    { error: vi.fn() } as never,
    'import { t } from "@palamedes/core/macro"\nexport const label = t`Hello`',
    "/repo/src/label.ts"
  )
}

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
  options: Parameters<typeof palamedes>[0] = {},
  command?: "build" | "serve"
) {
  const plugins = palamedes(options)
  if (command) {
    const macroPlugin = plugins.find((plugin) => plugin.name === "palamedes:transform")
    if (typeof macroPlugin?.config === "function") {
      macroPlugin.config.call(
        {} as any,
        {} as any,
        { command, mode: command === "serve" ? "development" : "production" } as any
      )
    }
  }
  const mdxPlugin = plugins.find((plugin) => plugin.name === "palamedes:mdx")
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

async function runMdxConfig(options: Parameters<typeof palamedes>[0] = {}) {
  const mdxPlugin = palamedes(options).find((plugin) => plugin.name === "palamedes:mdx")
  const config = mdxPlugin?.config

  if (typeof config !== "function") {
    throw new TypeError("Expected palamedes:mdx config hook")
  }

  return config.call(
    {} as any,
    {} as any,
    {
      command: "build",
      mode: "production",
    } as any
  )
}
