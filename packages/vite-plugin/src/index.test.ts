import { runInNewContext } from "node:vm";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as PalamedesConfigModule from "@palamedes/config";
import type * as PalamedesCoreNodeModule from "@palamedes/core-node";
import type * as PalamedesTransformModule from "@palamedes/transform";
import type { Plugin } from "vite";

const mocks = vi.hoisted(() => ({
  loadPalamedesConfig: vi.fn(),
  analyzeMdxNative: vi.fn(),
  compileCatalogArtifactSelected: vi.fn(),
  compileCatalogModule: vi.fn(),
  createMissingErrorMessage: vi.fn(),
  renderCatalogModule: vi.fn(),
  transformPalamedesMacros: vi.fn(),
}));

vi.mock("@palamedes/config", async (importOriginal) => {
  // Catalog path resolution is pure and shared with the Next loader — exercise
  // the real implementation so these tests pin the resolved paths.
  const actual = await importOriginal<typeof PalamedesConfigModule>();
  return {
    loadPalamedesConfig: mocks.loadPalamedesConfig,
    resolveCatalogPath: actual.resolveCatalogPath,
    catalogMatchesSource: actual.catalogMatchesSource,
    catalogResourcePath: actual.catalogResourcePath,
    getConfigDependencies: actual.getConfigDependencies,
    createPalamedesSourceFilter: actual.createPalamedesSourceFilter,
    resolvePalamedesConfigPath: actual.resolvePalamedesConfigPath,
    resolvePalamedesProjectRoot: actual.resolvePalamedesProjectRoot,
  };
});

vi.mock("@palamedes/core-node", async (importOriginal) => ({
  assertNoRemovedPalamedesOptions: (await importOriginal<typeof PalamedesCoreNodeModule>())
    .assertNoRemovedPalamedesOptions,
  analyzeMdxNative: mocks.analyzeMdxNative,
  compileCatalogArtifactSelectedAsync: mocks.compileCatalogArtifactSelected,
  compileCatalogModuleAsync: mocks.compileCatalogModule,
  renderCatalogModule: mocks.renderCatalogModule,
}));

vi.mock("@palamedes/transform", async (importOriginal) => {
  // Framework resolution is pure and shared across plugins — exercise the real
  // implementation so these tests pin the derived defaults, not a stub.
  const actual = await importOriginal<typeof PalamedesTransformModule>();
  return {
    PALAMEDES_BUNDLER_TRANSFORM_INCLUDE: actual.PALAMEDES_BUNDLER_TRANSFORM_INCLUDE,
    PALAMEDES_MACRO_PACKAGES: ["@palamedes/core/macro", "@palamedes/react/macro"],
    createMissingErrorMessage: mocks.createMissingErrorMessage,
    transformPalamedesMacros: mocks.transformPalamedesMacros,
    resolveMacroRuntimeModule: actual.resolveMacroRuntimeModule,
    mdxFrameworkFor: actual.mdxFrameworkFor,
  };
});

import { palamedes } from "./index";

function transformHandler(transform: Plugin["transform"]) {
  if (typeof transform === "function") {
    return transform;
  }
  if (transform && typeof transform === "object") {
    return transform.handler;
  }
}

// catalogResourcePath() resolves configured catalog paths. Keep the mocked
// native boundary aligned with the host path convention so this suite covers
// the Windows path it receives in production as well as POSIX paths.
const deCatalogPath = path.resolve("/repo/src/locales/de.po");

beforeEach(() => {
  mocks.loadPalamedesConfig.mockResolvedValue({
    configPath: "/repo/palamedes.yaml",
    rootDir: "/repo",
    locales: ["en", "de", "pseudo"],
    sourceLocale: "en",
    pseudoLocale: "pseudo",
    fallbackLocales: undefined,
    catalogs: [{ path: "src/locales/{locale}", include: ["src/**/*"] }],
  });
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
  });
  mocks.compileCatalogModule.mockResolvedValue({
    code: 'export const messages={"greeting":"Hallo"};export default { messages };',
    warnings: [],
    watchFiles: ["/repo/src/locales/en.po"],
  });
  mocks.compileCatalogArtifactSelected.mockResolvedValue({
    messages: {},
    missing: [],
    diagnostics: [],
    watchFiles: ["/repo/src/locales/de.po", "/repo/src/locales/en.po"],
    resolvedLocaleChain: ["de", "en"],
  });
  mocks.createMissingErrorMessage.mockImplementation(
    (locale: string, missing: unknown[]) =>
      `Missing ${missing.length} translation(s) for locale ${locale}`,
  );
  mocks.renderCatalogModule.mockImplementation(
    (messages: Record<string, string>) =>
      `/*rendered*/export const messages=${JSON.stringify(messages)};export default { messages };`,
  );
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("palamedes vite plugin", () => {
  it("generates a server-only lazy catalog virtual module", async () => {
    const plugin = palamedes().find((candidate) => candidate.name === "palamedes:server-catalogs");
    const hooks = plugin as any;
    expect(hooks?.resolveId?.("virtual:palamedes/server-catalogs")).toBe(
      "\0palamedes:server-catalogs",
    );

    const addWatchFile = vi.fn();
    const error = vi.fn((message: unknown) => {
      throw new Error(String(message));
    });
    const load = hooks?.load as (
      this: any,
      id: string,
      options?: { ssr?: boolean },
    ) => Promise<any>;
    if (typeof load !== "function") {
      throw new TypeError("Expected server catalog virtual module load hook");
    }

    const result = await load.call(
      {
        environment: { config: { consumer: "server" } },
        addWatchFile,
        error,
      } as never,
      "\0palamedes:server-catalogs",
      { ssr: true },
    );

    expect(result.code).toContain(
      `import(${JSON.stringify(path.resolve("/repo/src/locales/en.po").replaceAll("\\", "/"))})`,
    );
    expect(result.code).toContain(
      `import(${JSON.stringify(path.resolve("/repo/src/locales/de.po").replaceAll("\\", "/"))})`,
    );
    expect(result.code).toContain("createServerCatalogStore");
    expect(result.code).toContain("Unsupported catalog locale");
    expect(result.code).not.toContain('import "');
    expect(addWatchFile).toHaveBeenCalled();
    await expect(
      load.call(
        {
          environment: { config: { consumer: "client" } },
          addWatchFile,
          error,
        } as never,
        "\0palamedes:server-catalogs",
        { ssr: false },
      ),
    ).rejects.toThrow("server-only");
  });

  it("resolves @palamedes/runtime/node to the bundled catalog store in server builds", async () => {
    const plugin = palamedes().find((candidate) => candidate.name === "palamedes:node-i18n");
    const resolveId = (plugin as any)?.resolveId as (
      this: any,
      id: string,
      importer?: string,
      options?: { ssr?: boolean },
    ) => unknown;
    const resolve = vi.fn(async (id: string) => ({ id: `/resolved/${id}` }));
    const server = { environment: { config: { consumer: "server" } }, resolve };
    const client = { environment: { config: { consumer: "client" } }, resolve };

    await expect(
      resolveId.call(server, "@palamedes/runtime/node", "/repo/src/i18n.ts", { ssr: true }),
    ).resolves.toEqual({ id: "/resolved/@palamedes/runtime/server/bundled" });
    expect(resolve).toHaveBeenCalledWith("@palamedes/runtime/server/bundled", "/repo/src/i18n.ts", {
      skipSelf: true,
    });
    expect(resolveId.call(client, "@palamedes/runtime/node", "/repo/src/i18n.ts")).toBeNull();
    expect(resolveId.call(server, "@palamedes/runtime/server", "/repo/src/i18n.ts")).toBeNull();
  });

  it("hashes generated route facade output instead of a fixed marker", () => {
    const routePlugin = palamedes().find(
      (plugin) => plugin.name === "palamedes:react-router-route-boundaries",
    );
    if (!routePlugin?.augmentChunkHash) throw new Error("Route facade plugin is missing.");
    const route = {
      facadeModuleId: "/repo/routes/home.tsx?__react-router-build-client-route",
      code: "export default function Home() {}",
      fileName: "assets/home.js",
      exports: ["default"],
    };
    const withNamedExport = { ...route, exports: ["default", "meta"] };
    const augmentChunkHash =
      typeof routePlugin.augmentChunkHash === "function"
        ? routePlugin.augmentChunkHash
        : routePlugin.augmentChunkHash.handler;
    expect(augmentChunkHash.call({} as never, route as never)).not.toBe(
      augmentChunkHash.call({} as never, withNamedExport as never),
    );
  });

  it("removes stale source map references from moved route assets", () => {
    const routePlugin = palamedes().find(
      (plugin) => plugin.name === "palamedes:react-router-route-boundaries",
    );
    if (!routePlugin?.generateBundle) throw new Error("Route facade plugin is missing.");
    const emitFile = vi.fn();
    const bundle = {
      "assets/home.js": {
        type: "chunk" as const,
        facadeModuleId: "/repo/routes/home.tsx?__react-router-build-client-route",
        code: "export default function Home() {}\n//# sourceMappingURL=home.js.map",
        fileName: "assets/home.js",
        exports: ["default"],
      },
    };
    const generateBundle =
      typeof routePlugin.generateBundle === "function"
        ? routePlugin.generateBundle
        : routePlugin.generateBundle.handler;
    generateBundle.call({ emitFile } as never, {} as never, bundle as never, false);
    expect(emitFile).toHaveBeenCalledWith(
      expect.objectContaining({ source: expect.not.stringContaining("sourceMappingURL") }),
    );
  });

  it("generates a server-only lazy catalog store for configured locales", async () => {
    const addWatchFile = vi.fn();
    const serverCatalogs = palamedes().find(
      (plugin) => plugin.name === "palamedes:server-catalogs",
    );
    if (typeof serverCatalogs?.load !== "function") {
      throw new TypeError("Expected server catalog virtual module hook");
    }

    const result = await serverCatalogs.load.call(
      {
        addWatchFile,
        environment: { name: "ssr", config: { consumer: "server" } },
      } as never,
      "\0palamedes:server-catalogs",
      { ssr: true } as never,
    );

    const code = typeof result === "string" ? result : result?.code;
    expect(code).toContain('import { createServerCatalogStore } from "@palamedes/runtime/server";');
    expect(code).toContain('"en": () => Promise.all([');
    expect(code).toContain('"de": () => Promise.all([');
    expect(code).toContain('"pseudo": () => Promise.all([');
    expect(code).toContain(
      `import(${JSON.stringify(path.resolve("/repo/src/locales/en.po").replaceAll("\\", "/"))})`,
    );
    expect(code).toContain("export const loadServerCatalog=(locale)=>store.load(locale);");
    expect(addWatchFile).toHaveBeenCalledWith("/repo/palamedes.yaml");
  });

  it("rejects the server catalog virtual module in browser environments", async () => {
    const serverCatalogs = palamedes().find(
      (plugin) => plugin.name === "palamedes:server-catalogs",
    );
    if (typeof serverCatalogs?.load !== "function") {
      throw new TypeError("Expected server catalog virtual module hook");
    }
    const error = vi.fn((message: string) => {
      throw new Error(message);
    });

    await expect(
      serverCatalogs.load.call(
        { error, environment: { name: "client", config: { consumer: "client" } } } as never,
        "\0palamedes:server-catalogs",
        { ssr: false } as never,
      ),
    ).rejects.toThrow("virtual:palamedes/server-catalogs is server-only");
    expect(error).toHaveBeenCalledOnce();
  });

  it("loads server catalogs without a Vite environment when configured for the server", async () => {
    const serverCatalogsFor = (options?: Parameters<typeof palamedes>[0]) => {
      const plugin = palamedes(options).find((entry) => entry.name === "palamedes:server-catalogs");
      if (typeof plugin?.load !== "function") {
        throw new TypeError("Expected server catalog virtual module hook");
      }
      return plugin.load;
    };
    const error = vi.fn((message: string) => {
      throw new Error(message);
    });
    // tsdown and plain Rolldown call load() with neither an environment nor ssr.
    const context = { addWatchFile: vi.fn(), error } as never;

    await expect(
      serverCatalogsFor().call(context, "\0palamedes:server-catalogs", {} as never),
    ).rejects.toThrow("virtual:palamedes/server-catalogs is server-only");

    const result = await serverCatalogsFor({ environment: "server" }).call(
      context,
      "\0palamedes:server-catalogs",
      {} as never,
    );
    const code = typeof result === "string" ? result : result?.code;
    expect(code).toContain("export const loadServerCatalog=(locale)=>store.load(locale);");
  });

  it("resolves the Node i18n setup to the bundled store without a Vite environment when configured for the server", async () => {
    const resolveIdFor = (options?: Parameters<typeof palamedes>[0]) =>
      (palamedes(options).find((candidate) => candidate.name === "palamedes:node-i18n") as any)
        ?.resolveId as (this: any, id: string, importer?: string) => unknown;
    const resolve = vi.fn(async (id: string) => ({ id: `/resolved/${id}` }));

    expect(
      resolveIdFor().call({ resolve }, "@palamedes/runtime/node", "/repo/src/i18n.ts"),
    ).toBeNull();
    await expect(
      resolveIdFor({ environment: "server" }).call(
        { resolve },
        "@palamedes/runtime/node",
        "/repo/src/i18n.ts",
      ),
    ).resolves.toEqual({ id: "/resolved/@palamedes/runtime/server/bundled" });
  });

  it("rejects an unknown environment", () => {
    expect(() => palamedes({ environment: "client" as never })).toThrow(
      'Palamedes environment must be "auto" or "server", received "client".',
    );
  });

  it.each(["label.mjs", "label.cjs", "label.mts", "label.cts"])(
    "transforms %s with the shared bundler default",
    (file) => {
      expect(runMacroTransform({}, undefined, [], `/repo/src/${file}`)).toMatchObject({
        code: "transformed",
      });
    },
  );

  it("compiles PO files and registers watch dependencies", async () => {
    const addWatchFile = vi.fn();
    const result = await runPoTransform({ addWatchFile });

    expect(result).toStrictEqual({
      code: 'export const messages={"greeting":"Hallo"};export default { messages };',
      map: null,
    });
    expect(addWatchFile).toHaveBeenCalledWith("/repo/src/locales/en.po");
    expect(mocks.compileCatalogModule).toHaveBeenCalledWith(
      expect.objectContaining({ rootDir: "/repo", sourceLocale: "en" }),
      "/repo/src/locales/de.po",
      expect.objectContaining({
        locale: "de",
        failOnMissing: false,
      }),
    );
  });

  it("compiles FCL files through the same native catalog loader", async () => {
    await runPoTransform({}, {}, "/repo/src/locales/de.fcl");

    expect(mocks.compileCatalogModule).toHaveBeenCalledWith(
      expect.objectContaining({ rootDir: "/repo", sourceLocale: "en" }),
      "/repo/src/locales/de.fcl",
      expect.objectContaining({ locale: "de", failOnMissing: false }),
    );
  });

  it.each([
    ["locales/{locale}/messages.fcl", "/repo/locales/de/messages.fcl", "fcl"],
    ["messages-{locale}.po", "/repo/messages-de.po", undefined],
  ])(
    "derives the configured locale from a nonstandard catalog path",
    async (pattern, id, format) => {
      mocks.loadPalamedesConfig.mockResolvedValue({
        configPath: "/repo/palamedes.yaml",
        rootDir: "/repo",
        locales: ["en", "de"],
        sourceLocale: "en",
        catalogs: [{ path: pattern, include: ["src/**/*"], ...(format ? { format } : {}) }],
      });

      await runPoTransform({}, {}, id);

      expect(mocks.compileCatalogModule).toHaveBeenCalledWith(
        expect.anything(),
        id,
        expect.objectContaining({ locale: "de" }),
      );
    },
  );

  it.each([
    [
      "failOnCompileError",
      false,
      "Palamedes v2 removed failOnCompileError: invalid ICU always fails compilation. Remove the option; use failOnMissing for translation completeness.",
    ],
    [
      "failOnCompileError",
      true,
      "Palamedes v2 removed failOnCompileError: invalid ICU always fails compilation. Remove the option; use failOnMissing for translation completeness.",
    ],
    [
      "keepSourceFallbacks",
      true,
      "Palamedes v2 renamed keepSourceFallbacks to includeSourceMetadata: it only adds diagnostic source metadata. Rename the option; the v2 default is false.",
    ],
    [
      "experimentalGraphSplitting",
      true,
      "Palamedes v2 removed experimentalGraphSplitting: compiled catalogs are delivered automatically through an import map. Remove the option, including any localeBinding setting.",
    ],
    [
      "experimentalGraphSplitting",
      false,
      "Palamedes v2 removed experimentalGraphSplitting: compiled catalogs are delivered automatically through an import map. Remove the option, including any localeBinding setting.",
    ],
    [
      "experimentalGraphSplitting",
      { localeBinding: "embed" },
      "Palamedes v2 removed experimentalGraphSplitting: compiled catalogs are delivered automatically through an import map. Remove the option, including any localeBinding setting.",
    ],
    [
      "cwd",
      "/repo",
      "Palamedes v2 renamed cwd to projectRoot: relative configPath values and include/exclude globs resolve from it. Rename the option; the Vite plugin defaults it to Vite's root.",
    ],
  ] as const)("rejects the removed %s option (%j) during plugin setup", (name, value, message) => {
    expect(() => palamedes({ [name]: value } as Parameters<typeof palamedes>[0])).toThrow(message);
  });

  it("fails missing translations when configured", async () => {
    mocks.compileCatalogModule.mockRejectedValue(new Error("Missing 1 translation"));

    await expect(runPoTransform({}, { failOnMissing: true })).rejects.toThrow(
      /Missing 1 translation/,
    );
  });

  it("routes diagnostics through the plugin warning channel when not fatal", async () => {
    mocks.compileCatalogModule.mockResolvedValue({
      code: "export const messages={};export default { messages };",
      warnings: ["Catalog diagnostics for locale de"],
      watchFiles: [],
    });
    const warn = vi.fn();

    await runPoTransform({ warn });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Catalog diagnostics for locale de"));
  });

  it.each(["react", "solid"] as const)(
    "compiles MDX for the %s runtime with native source maps",
    async (framework) => {
      const addWatchFile = vi.fn();
      const result = await runMdxTransform(
        { addWatchFile },
        {
          mdx: {
            framework,
            translatableAttributes: ["alt", "title"],
            frontMatterFields: ["title"],
          },
        },
      );

      expect(result).toStrictEqual({
        code: expect.stringContaining(
          "export default function MDXContent() { return <p>Translated</p> }",
        ),
        map: expect.objectContaining({ mappings: "AAAA" }),
        ...(framework === "react" ? { moduleType: "jsx" } : {}),
      });
      expect(mocks.analyzeMdxNative).toHaveBeenCalledWith(
        "# Welcome",
        "/repo/src/guide.mdx",
        expect.objectContaining({
          framework,
          translatableAttributes: ["alt", "title"],
          frontMatterFields: ["title"],
        }),
      );
      expect(addWatchFile).toHaveBeenCalledWith("/repo/palamedes.yaml");
    },
  );

  it("keeps generated MDX hook-free", async () => {
    mocks.analyzeMdxNative.mockClear();
    await runMdxTransform({}, { runtimeModule: "@acme/macro-runtime" });

    const mdxOptions = mocks.analyzeMdxNative.mock.calls[0]?.[2] as
      | Record<string, unknown>
      | undefined;
    expect(mdxOptions).toBeDefined();
    expect(mdxOptions).toHaveProperty("runtimeModule", "@palamedes/runtime");
  });

  it("lets MDX configuration set its own runtime module", async () => {
    await runMdxTransform(
      {},
      {
        runtimeModule: "@acme/macro-runtime",
        mdx: { runtimeModule: "@acme/mdx-runtime" },
      },
    );

    expect(mocks.analyzeMdxNative).toHaveBeenCalledWith(
      "# Welcome",
      "/repo/src/guide.mdx",
      expect.objectContaining({ runtimeModule: "@acme/mdx-runtime" }),
    );
  });

  it("validates compiled MDX IDs when failOnMissing is enabled", async () => {
    mocks.compileCatalogArtifactSelected.mockReturnValueOnce({
      messages: {},
      missing: [{ sourceKey: { message: "Welcome" } }],
      diagnostics: [],
      watchFiles: ["/repo/src/locales/de.po", "/repo/src/locales/en.po"],
      resolvedLocaleChain: ["de", "en"],
    });

    await expect(runMdxTransform({}, { failOnMissing: true })).rejects.toThrow(
      /Missing 1 translation.*failOnMissing=true/s,
    );
    expect(mocks.compileCatalogArtifactSelected).toHaveBeenCalledWith(
      expect.objectContaining({
        catalogs: [{ path: "src/locales/{locale}", include: ["src/**/*"] }],
      }),
      deCatalogPath,
      ["message-id"],
    );
  });

  it("configures JSX module parsing only for React MDX", async () => {
    await expect(runMdxConfig()).resolves.toMatchObject({
      build: {
        rollupOptions: {
          moduleTypes: {
            ".mdx": "jsx",
          },
        },
      },
    });
    await expect(runMdxConfig({ mdx: { framework: "solid" } })).resolves.toBeUndefined();
  });

  it("does not require an auto-discovered config during Vite startup", async () => {
    mocks.loadPalamedesConfig.mockRejectedValueOnce(
      new Error("Could not find a Palamedes config. Expected one of palamedes.yaml."),
    );

    await expect(runMdxConfig()).resolves.toBeUndefined();
  });

  it("does not hide config errors other than missing auto-discovery", async () => {
    mocks.loadPalamedesConfig.mockRejectedValueOnce(new Error("Invalid Palamedes config"));

    await expect(runMdxConfig()).rejects.toThrow("Invalid Palamedes config");
  });

  it("still requires a config when an MDX module is transformed", async () => {
    mocks.loadPalamedesConfig.mockRejectedValueOnce(
      new Error("Could not find a Palamedes config. Expected one of palamedes.yaml."),
    );

    await expect(runMdxTransform()).rejects.toThrow("Could not find a Palamedes config");
  });

  it("does not let the JavaScript include filter disable MDX", async () => {
    await expect(runMdxTransform({}, { include: "src/**/*.ts" })).resolves.toMatchObject({
      moduleType: "jsx",
    });
  });

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
    });
    const error = vi.fn((diagnostic: unknown) => {
      const message =
        typeof diagnostic === "string" ? diagnostic : (diagnostic as { message?: string }).message;
      throw new Error(message);
    });

    await expect(runMdxTransform({ error })).rejects.toThrow(
      /\/repo\/src\/guide\.mdx:3:1: unclosed JSX tag \(UnclosedJsxTag\)/,
    );
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "PALAMEDES_MDX",
        id: "/repo/src/guide.mdx",
        loc: { file: "/repo/src/guide.mdx", line: 3, column: 0 },
      }),
    );
  });

  it("can disable first-class MDX compilation", () => {
    const plugins = palamedes({ mdx: false });
    expect(plugins.some((plugin) => plugin.name === "palamedes:mdx")).toBe(false);
    const macroTransform = transformHandler(
      plugins.find((plugin) => plugin.name === "palamedes:transform")?.transform,
    );
    if (typeof macroTransform !== "function") {
      throw new TypeError("Expected macro transform hook");
    }
    expect(
      macroTransform.call(
        { error: vi.fn() } as any,
        'import { Trans } from "@palamedes/react/macro"\n# Hello',
        "/repo/src/guide.mdx",
      ),
    ).toBeNull();
  });

  it("invalidates compiled MDX modules when the Palamedes config changes", async () => {
    const mdxPlugin = palamedes().find((plugin) => plugin.name === "palamedes:mdx");
    const transform = transformHandler(mdxPlugin?.transform);
    const handleHotUpdate = mdxPlugin?.handleHotUpdate;
    if (typeof transform !== "function" || typeof handleHotUpdate !== "function") {
      throw new TypeError("Expected MDX transform and HMR hooks");
    }
    await transform.call({ addWatchFile() {} } as any, "# Welcome", "/repo/src/guide.mdx");
    const module = { id: "/repo/src/guide.mdx" };
    const invalidateModule = vi.fn();

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
      } as any,
    );

    expect(invalidateModule).toHaveBeenCalledWith(module);
    expect(invalidated).toStrictEqual([module]);
  });

  it("runs macro lowering on compiled MDX when authored macro imports remain", async () => {
    mocks.transformPalamedesMacros.mockReturnValue({
      code: "export default function Guide() { return translated }",
      hasChanged: true,
      compiledIds: ["message-id"],
      map: null,
    });
    const macroPlugin = palamedes().find((plugin) => plugin.name === "palamedes:transform");
    const transform = transformHandler(macroPlugin?.transform);
    if (typeof transform !== "function") {
      throw new TypeError("Expected macro transform hook");
    }
    const code =
      'import { Trans } from "@palamedes/react/macro"\nexport default <Trans>Hello</Trans>';

    const result = await transform.call(
      { error: vi.fn(), addWatchFile() {} } as any,
      code,
      "/repo/src/guide.mdx",
    );

    expect(mocks.transformPalamedesMacros).toHaveBeenCalledWith(
      code,
      "/repo/src/guide.mdx",
      expect.any(Object),
    );
    expect(result).toMatchObject({ code: expect.stringContaining("translated") });
  });

  it.each([
    ["react", undefined, "@palamedes/runtime"],
    ["solid", "solid", "@palamedes/runtime"],
    ["none", "none", "@palamedes/runtime"],
  ] as const)(
    "derives the macro runtime module for %s",
    (_label, framework, expectedRuntimeModule) => {
      runMacroTransform(framework === undefined ? {} : { framework });

      expect(mocks.transformPalamedesMacros).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ runtimeModule: expectedRuntimeModule }),
      );
    },
  );

  it("lets an explicit runtime module override the framework default", () => {
    runMacroTransform({ framework: "react", runtimeModule: "@acme/custom-runtime" });

    expect(mocks.transformPalamedesMacros).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ runtimeModule: "@acme/custom-runtime" }),
    );
  });

  it.each([
    ["build", false, true],
    ["serve", false, false],
  ] as const)(
    "sets source metadata defaults for Vite %s",
    (command, expectedSourceMetadata, expectedMetadataStrip) => {
      runMacroTransform({}, command);

      expect(mocks.transformPalamedesMacros).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          includeSourceMetadata: expectedSourceMetadata,
          stripNonEssentialProps: expectedMetadataStrip,
        }),
      );
    },
  );

  it("passes includeSourceMetadata to macro transforms", () => {
    runMacroTransform({ includeSourceMetadata: true }, "build");

    expect(mocks.transformPalamedesMacros).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ includeSourceMetadata: true }),
    );
  });

  it("applies the source metadata mode to compiled MDX", async () => {
    await runMdxTransform({}, {}, "build");

    expect(mocks.analyzeMdxNative).toHaveBeenCalledWith(
      "# Welcome",
      "/repo/src/guide.mdx",
      expect.objectContaining({ includeSourceMetadata: false }),
    );

    mocks.analyzeMdxNative.mockClear();
    await runMdxTransform({}, { includeSourceMetadata: true }, "build");

    expect(mocks.analyzeMdxNative).toHaveBeenCalledWith(
      "# Welcome",
      "/repo/src/guide.mdx",
      expect.objectContaining({ includeSourceMetadata: true }),
    );
  });

  it("seeds MDX options from the framework option", async () => {
    mocks.analyzeMdxNative.mockClear();
    await runMdxTransform({}, { framework: "solid" });

    expect(mocks.analyzeMdxNative).toHaveBeenCalledWith(
      "# Welcome",
      "/repo/src/guide.mdx",
      expect.objectContaining({ framework: "solid" }),
    );
  });

  it("lets MDX configuration override the framework option", async () => {
    mocks.analyzeMdxNative.mockClear();
    await runMdxTransform({}, { framework: "solid", mdx: { framework: "react" } });

    expect(mocks.analyzeMdxNative).toHaveBeenCalledWith(
      "# Welcome",
      "/repo/src/guide.mdx",
      expect.objectContaining({ framework: "react" }),
    );
  });
});

describe("automatic graph splitting", () => {
  it("reloads sidecars after config edits without the MDX or PO plugins", async () => {
    mocks.transformPalamedesMacros.mockReturnValue({
      code: "transformed",
      hasChanged: true,
      compiledIds: ["message-id"],
      map: null,
    });
    const initialConfig = {
      configDependencies: ["/repo/palamedes.yaml", "/repo/config/settings.ts"],
      configPath: "/repo/palamedes.yaml",
      rootDir: "/repo",
      locales: ["en", "de"],
      sourceLocale: "en",
      fallbackLocales: { de: ["en"] },
      catalogs: [{ path: "src/locales/{locale}", include: ["src/**/*"] }],
    };
    const updatedConfig = {
      configDependencies: ["/repo/palamedes.yaml", "/repo/config/settings.ts"],
      configPath: "/repo/palamedes.yaml",
      rootDir: "/repo",
      locales: ["en", "fr"],
      sourceLocale: "en",
      fallbackLocales: { fr: ["en"] },
      catalogs: [{ path: "translations/{locale}", include: ["src/**/*"] }],
    };
    mocks.loadPalamedesConfig
      .mockResolvedValueOnce(initialConfig)
      .mockResolvedValueOnce(initialConfig)
      .mockResolvedValueOnce(updatedConfig);

    const plugins = palamedes({
      mdx: false,
      enablePoLoader: false,
    });
    const transformPlugin = plugins.find((plugin) => plugin.name === "palamedes:transform");
    const sidecarPlugin = plugins.find((plugin) => plugin.name === "palamedes:message-sidecars");
    const buildStart = transformPlugin?.buildStart;
    const transform = transformHandler(transformPlugin?.transform);
    const watchChange = transformPlugin?.watchChange;
    const load = sidecarPlugin?.load;
    if (
      typeof buildStart !== "function" ||
      typeof transform !== "function" ||
      typeof watchChange !== "function" ||
      typeof load !== "function"
    ) {
      throw new TypeError("Expected always-present transform and graph-splitting hooks");
    }
    expect(plugins.some((plugin) => plugin.name === "palamedes:mdx")).toBe(false);
    expect(plugins.some((plugin) => plugin.name === "palamedes:po-loader")).toBe(false);

    const transformed = (await transform.call(
      { error: vi.fn() } as never,
      'import { t } from "@palamedes/core/macro"\nexport const label = t`Hello`',
      "/repo/src/label.ts",
    )) as { code?: string } | null;
    const key = /virtual:palamedes-messages\/([0-9a-f]{12})/.exec(transformed?.code ?? "")?.[1];
    if (!key) {
      throw new TypeError("Expected a graph-splitting sidecar import");
    }
    const context = {
      addWatchFile: vi.fn(),
      error(message: unknown) {
        throw message instanceof Error ? message : new Error(String(message));
      },
      warn: vi.fn(),
    };

    const configLoadsBeforeBuildStart = mocks.loadPalamedesConfig.mock.calls.length;
    buildStart.call({} as never, {} as never);
    const beforeEdit = await load.call(context as never, `\0palamedes:messages/${key}`);
    const beforeEditCode = typeof beforeEdit === "string" ? beforeEdit : beforeEdit?.code;
    expect(beforeEditCode).toContain(`virtual:palamedes-messages/${key}/de`);
    expect(context.addWatchFile).toHaveBeenCalledWith("/repo/config/settings.ts");
    expect(mocks.loadPalamedesConfig).toHaveBeenCalledTimes(configLoadsBeforeBuildStart + 1);

    watchChange.call({} as never, "/repo/config/settings.ts", { event: "update" } as never);

    const afterEdit = await load.call(context as never, `\0palamedes:messages/${key}`);
    const afterEditCode = typeof afterEdit === "string" ? afterEdit : afterEdit?.code;
    expect(afterEditCode).toContain(`virtual:palamedes-messages/${key}/fr`);
    expect(afterEditCode).not.toContain(`virtual:palamedes-messages/${key}/de`);

    await load.call(context as never, `\0palamedes:messages/${key}/fr`);
    expect(mocks.compileCatalogArtifactSelected).toHaveBeenLastCalledWith(
      expect.objectContaining({
        catalogs: [{ path: "translations/{locale}", include: ["src/**/*"] }],
        fallbackLocales: { fr: ["en"] },
      }),
      path.resolve("/repo/translations/fr.po"),
      ["message-id"],
    );
  });

  it("appends a sidecar import to modules that reference messages", async () => {
    const result = (await runMacroTransform({}, undefined, ["id-a", "id-b"])) as {
      code?: string;
    } | null;

    expect(result?.code).toMatch(
      /^transformed\nimport "virtual:palamedes-messages\/[0-9a-f]{12}";\n$/,
    );
  });

  it("derives reproducible sidecar output from the Palamedes-root-relative path", async () => {
    mocks.renderCatalogModule.mockImplementation((messages: Record<string, string>) =>
      nativeModuleShape(JSON.stringify(messages)),
    );

    async function sidecarOutput(rootDir: string) {
      const sourceId = `${rootDir}/src/label.ts`;
      mocks.loadPalamedesConfig.mockResolvedValue({
        configPath: `${rootDir}/palamedes.yaml`,
        rootDir,
        locales: ["en", "de", "pseudo"],
        sourceLocale: "en",
        pseudoLocale: "pseudo",
        fallbackLocales: undefined,
        catalogs: [{ path: "src/locales/{locale}", include: ["src/**/*"] }],
      });
      const result = await runSidecarLoad(
        ["id-a"],
        {},
        { pluginOptions: {}, command: "build", sourceId },
      );
      return {
        transformedCode: result.transformedCode,
        registration: await result.load(`\0palamedes:messages/${result.key}`, { ssr: false }),
        emitted: await emitImportMap(result.sidecarPlugin, result.key),
      };
    }

    const first = await sidecarOutput("/builds/runner-one/project");
    const second = await sidecarOutput("/builds/runner-two/project");

    expect(second).toStrictEqual(first);
  });

  it("normalizes Windows separators before hashing the root-relative path", async () => {
    mocks.loadPalamedesConfig.mockResolvedValue({
      configPath: "C:\\checkout\\project\\palamedes.yaml",
      rootDir: "C:\\checkout\\project",
      locales: ["en"],
      sourceLocale: "en",
      catalogs: [],
    });

    const result = (await runMacroTransform(
      {},
      undefined,
      ["id-a"],
      "c:\\checkout\\project\\src\\label.ts",
    )) as { code?: string } | null;
    const expectedKey = createHash("sha256").update("src/label.ts").digest("hex").slice(0, 12);

    expect(result?.code).toContain(`virtual:palamedes-messages/${expectedKey}`);
  });

  it("uses a portable relative identity for sources outside the Palamedes root", async () => {
    mocks.loadPalamedesConfig.mockResolvedValue({
      configPath: "/checkout/project/palamedes.yaml",
      rootDir: "/checkout/project",
      locales: ["en"],
      sourceLocale: "en",
      catalogs: [],
    });

    const sourceId = "/checkout/shared/label.ts";
    const result = (await runMacroTransform({}, undefined, ["id-a"], sourceId)) as {
      code?: string;
    } | null;
    const expectedKey = createHash("sha256")
      .update("../shared/label.ts")
      .digest("hex")
      .slice(0, 12);

    expect(result?.code).toContain(`virtual:palamedes-messages/${expectedKey}`);
    expect(result?.code).not.toContain("checkout");
  });

  it("rejects a cross-volume Windows source instead of hashing its absolute path", async () => {
    mocks.loadPalamedesConfig.mockResolvedValue({
      configPath: "D:\\checkout\\project\\palamedes.yaml",
      rootDir: "D:\\checkout\\project",
      locales: ["en"],
      sourceLocale: "en",
      catalogs: [],
    });

    await expect(
      runMacroTransform({}, undefined, ["id-a"], "C:\\shared\\label.ts"),
    ).rejects.toThrow(
      /Palamedes transform error in C:\\shared\\label\.ts:.*different filesystem volume/,
    );
  });

  it("wraps asynchronous sidecar config failures with the transformed file", async () => {
    mocks.loadPalamedesConfig.mockRejectedValueOnce(new Error("Invalid Palamedes config"));

    await expect(runMacroTransform({}, undefined, ["id-a"])).rejects.toThrow(
      "Palamedes transform error in /repo/src/label.ts: Invalid Palamedes config",
    );
  });

  it("rejects Windows UNC sources on a different share before deriving a relative key", async () => {
    mocks.loadPalamedesConfig.mockResolvedValue({
      configPath: "\\\\checkout-server\\project\\palamedes.yaml",
      rootDir: "\\\\checkout-server\\project",
      locales: ["en"],
      sourceLocale: "en",
      catalogs: [],
    });

    await expect(
      runMacroTransform({}, undefined, ["id-a"], "\\\\checkout-server\\shared\\label.ts"),
    ).rejects.toThrow(/different filesystem volume/);
  });

  it.skipIf(process.platform === "win32")(
    "canonicalizes symlinked module ids before deriving the sidecar key",
    async () => {
      const rootDir = mkdtempSync(path.join(tmpdir(), "palamedes-vite-sidecar-"));
      const sourceId = path.join(rootDir, "src", "label.ts");
      const symlinkId = path.join(rootDir, "linked-label.ts");
      mkdirSync(path.dirname(sourceId), { recursive: true });
      writeFileSync(sourceId, "export const label = 'Hello'\n");
      symlinkSync(sourceId, symlinkId);
      mocks.loadPalamedesConfig.mockResolvedValue({
        configPath: path.join(rootDir, "palamedes.yaml"),
        rootDir,
        locales: ["en"],
        sourceLocale: "en",
        catalogs: [],
      });

      try {
        const source = (await runMacroTransform({}, undefined, ["id-a"], sourceId)) as {
          code?: string;
        } | null;
        const symlink = (await runMacroTransform({}, undefined, ["id-a"], symlinkId)) as {
          code?: string;
        } | null;

        expect(symlink?.code).toBe(source?.code);
      } finally {
        rmSync(rootDir, { recursive: true, force: true });
      }
    },
  );

  it("keeps distinct in-root modules in distinct sidecars", async () => {
    const first = (await runMacroTransform({}, undefined, ["id-a"], "/repo/src/first.ts")) as {
      code?: string;
    } | null;
    const second = (await runMacroTransform({}, undefined, ["id-a"], "/repo/src/second.ts")) as {
      code?: string;
    } | null;

    expect(first?.code).not.toBe(second?.code);
  });

  it("leaves modules without message references untouched", async () => {
    const result = (await runMacroTransform({}, undefined, [])) as { code?: string } | null;

    expect(result?.code).toBe("transformed");
  });

  it("appends sidecar imports with default options", async () => {
    const result = (await runMacroTransform({}, undefined, ["id-a"])) as { code?: string } | null;

    expect(result?.code).toContain('import "virtual:palamedes-messages/');
  });

  it("awaits only the active development fragment before evaluating the source body", async () => {
    const { load, key } = await runSidecarLoad(["id-a"]);
    const result = await load(`\0palamedes:messages/${key}`);
    const code = result!
      .code!.replace(/^import .*;\n/gm, "")
      .replaceAll("import(", "loadFragment(");
    const events: string[] = [];
    const run = runInNewContext(
      `(document, initializeClientI18n, createI18n, loadFragment, events) => (async()=>{${code};events.push("body")})()`,
    );
    const document = { documentElement: { lang: "de", dataset: {} } };
    const i18n = { load: (locale: string) => events.push(`loaded:${locale}`) };
    const loadFragment = vi.fn(async (url: string) => {
      events.push(url);
      return { messages: {} };
    });
    await run(
      document,
      () => i18n,
      () => i18n,
      loadFragment,
      events,
    );
    expect(events).toEqual([`virtual:palamedes-messages/${key}/de`, "loaded:de", "body"]);
    events.length = 0;
    await expect(
      run(
        document,
        () => i18n,
        () => i18n,
        async () => {
          throw new Error("dependency failed");
        },
        events,
      ),
    ).rejects.toThrow("dependency failed");
    expect(events).toEqual([]);
    expect(mocks.compileCatalogArtifactSelected).not.toHaveBeenCalled();
  });

  it("appends a sidecar import to MDX modules that reference messages", async () => {
    const result = (await runMdxTransform({}, {})) as {
      code?: string;
    } | null;

    // MDX content splits exactly like `t`/`Trans` call sites: analyzeMdx
    // reports the same compiledIds, so the module carries its own messages.
    expect(result?.code).toMatch(/import "virtual:palamedes-messages\/[0-9a-f]{12}";\n$/);
    expect(result?.code).toContain("export default function MDXContent()");
  });

  it("wraps asynchronous MDX sidecar failures with the transformed file", async () => {
    mocks.loadPalamedesConfig.mockResolvedValue({
      configPath: "D:\\checkout\\project\\palamedes.yaml",
      rootDir: "D:\\checkout\\project",
      locales: ["en"],
      sourceLocale: "en",
      catalogs: [],
    });

    await expect(runMdxTransform({}, {}, undefined, "C:\\shared\\guide.mdx")).rejects.toThrow(
      /Palamedes transform error in C:\\shared\\guide\.mdx:.*different filesystem volume/,
    );
  });

  it("leaves MDX modules without messages untouched", async () => {
    mocks.analyzeMdxNative.mockReturnValue({
      messages: [],
      diagnostics: [],
      code: "export default function MDXContent() { return <p>Plain</p> }",
      compiledIds: [],
      map: null,
    });

    const result = (await runMdxTransform({}, {})) as {
      code?: string;
    } | null;

    expect(result?.code).toBe("export default function MDXContent() { return <p>Plain</p> }");
  });

  it("registers catalog files as watch dependencies of each sidecar", async () => {
    // Dev-mode translation updates ride on this: Vite invalidates the
    // generated modules when a watched catalog changes, so no separate
    // hot-update hook is needed.
    const { load, key, addWatchFile } = await runSidecarLoad(["id-a"]);
    await load(`\0palamedes:messages/${key}/de`);

    expect(addWatchFile).toHaveBeenCalledWith("/repo/src/locales/de.po");
    expect(addWatchFile).toHaveBeenCalledWith("/repo/palamedes.yaml");
  });

  it("renders per-locale modules through the native catalog renderer", async () => {
    mocks.compileCatalogArtifactSelected.mockImplementation(
      (_config: unknown, resourcePath: string) => ({
        messages: resourcePath === deCatalogPath ? { "id-a": "Hallo" } : { "id-a": "Hello" },
        missing: [],
        diagnostics: [],
        watchFiles: [resourcePath],
        resolvedLocaleChain: [],
      }),
    );

    const { load, key, addWatchFile } = await runSidecarLoad(["id-a"]);
    const result = await load(`\0palamedes:messages/${key}/de`);

    expect(mocks.compileCatalogArtifactSelected).toHaveBeenCalledTimes(1);
    expect(mocks.compileCatalogArtifactSelected).toHaveBeenCalledWith(
      expect.objectContaining({ rootDir: "/repo" }),
      deCatalogPath,
      ["id-a"],
    );
    expect(mocks.renderCatalogModule).toHaveBeenCalledWith({ "id-a": "Hallo" });
    expect(result?.code).toBe(
      `/*rendered*/export const messages={"id-a":"Hallo"};export default { messages };`,
    );
    expect(addWatchFile).toHaveBeenCalledWith(deCatalogPath);
  });

  it("replaces every {locale} placeholder in a catalog path", async () => {
    mocks.loadPalamedesConfig.mockResolvedValue({
      configPath: "/repo/palamedes.yaml",
      rootDir: "/repo",
      locales: ["en", "de"],
      sourceLocale: "en",
      catalogs: [{ path: "locales/{locale}/{locale}", include: ["src/**/*"] }],
    });

    const { load, key } = await runSidecarLoad(["id-a"]);
    await load(`\0palamedes:messages/${key}/de`);

    expect(mocks.compileCatalogArtifactSelected).toHaveBeenCalledWith(
      expect.objectContaining({ rootDir: "/repo" }),
      path.resolve("/repo/locales/de/de.po"),
      ["id-a"],
    );
  });

  it("warns on missing translations and keeps the sidecar buildable", async () => {
    mocks.compileCatalogArtifactSelected.mockReturnValue({
      messages: {},
      missing: [{ id: "id-a", message: "Hello" }],
      diagnostics: [],
      watchFiles: [],
      resolvedLocaleChain: [],
    });

    const warn = vi.fn();
    const { load, key } = await runSidecarLoad(["id-a"], { warn });
    const result = await load(`\0palamedes:messages/${key}/de`);

    expect(result?.code).toContain("export const messages");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("/repo/src/label.ts"));
  });

  function nativeModuleShape(map: string): string {
    return (
      `import{defineCompiledCatalog as __palamedesDefineCompiledCatalog}from"@palamedes/core/compiled";` +
      `export const messages=__palamedesDefineCompiledCatalog(${map});export default { messages };`
    );
  }

  it("binds production fragments to the document locale before module evaluation", async () => {
    const { load, key } = await runSidecarLoad(["id-a"], {}, { command: "build" });
    const result = await load(`\0palamedes:messages/${key}`, { ssr: false });
    expect(result?.code).toContain(`from "#pmds/${key}"`);
    expect(result?.code).toContain("document.documentElement.lang");
    expect(result?.code).toContain("if (l !== locale) throw");
    expect(result?.code).toContain("i18n.load(locale, defineCompiledCatalog(m))");
  });

  it("leaves server catalogs to the lazy shared server store", async () => {
    const { load, key } = await runSidecarLoad(["id-a"], {}, { command: "build" });
    expect(await load(`\0palamedes:messages/${key}`, { ssr: true })).toEqual({
      code: "export {};",
      map: null,
      moduleSideEffects: false,
    });
    expect(mocks.compileCatalogArtifactSelected).not.toHaveBeenCalled();
  });

  it("keeps dev-server aggregators on the embedded form under import-map binding", async () => {
    const { load, key } = await runSidecarLoad(
      ["id-a"],
      {},
      { pluginOptions: {}, command: "serve" },
    );
    const result = await load(`\0palamedes:messages/${key}`, { ssr: false });

    expect(result?.code).toContain(`virtual:palamedes-messages/${key}/en`);
    expect(result?.code).not.toContain("#pmds/");
  });

  it("externalizes generated specifiers without modifying host external filters", async () => {
    const { sidecarPlugin } = await runSidecarLoad(["id-a"]);
    const resolve = sidecarPlugin.resolveId;
    if (typeof resolve !== "function") throw new Error("Missing resolver hook");
    expect(resolve.call({} as never, "#pmds/abc123", undefined, {} as never)).toEqual({
      id: "#pmds/abc123",
      external: true,
    });
    expect(resolve.call({} as never, "react", undefined, {} as never)).toBeUndefined();
    expect(sidecarPlugin.config).toBeUndefined();
  });

  it("emits per-locale message assets, import maps, and the manifest", async () => {
    mocks.renderCatalogModule.mockImplementation((messages: Record<string, string>) =>
      nativeModuleShape(JSON.stringify(messages)),
    );
    mocks.compileCatalogArtifactSelected.mockImplementation(
      (_config: unknown, resourcePath: string) => ({
        messages: resourcePath === deCatalogPath ? { "id-a": "Hallo" } : { "id-a": "Hello" },
        missing: [],
        diagnostics: [],
        watchFiles: [],
        resolvedLocaleChain: [],
      }),
    );

    const { key, sidecarPlugin } = await runSidecarLoad(
      ["id-a"],
      {},
      { pluginOptions: {}, command: "build" },
    );
    const bundle = {
      "assets/home-abc.js": { type: "chunk", imports: [`#pmds/${key}`, "assets/vendor.js"] },
      "assets/vendor.js": { type: "chunk", imports: [] },
      "assets/style.css": { type: "asset" },
    };
    const emitted = await emitImportMap(sidecarPlugin, key, bundle);
    expect(bundle["assets/home-abc.js"].imports).toEqual(["assets/vendor.js"]);

    // One dependency-free asset per (sidecar x locale), pseudo included.
    const assets = emitted.filter((file) => file.fileName.startsWith("assets/palamedes-m-"));
    expect(assets).toHaveLength(3);
    const deAsset = assets.find((file) => file.fileName.includes(".de-"));
    expect(deAsset?.source).toBe(
      `export const locale="de";export const messages=({"id-a":"Hallo"});`,
    );
    expect(deAsset?.source).not.toContain("import");

    const maps = emitted.filter((file) => file.fileName.startsWith("assets/palamedes-importmap."));
    expect(maps).toHaveLength(3);
    const deMap = maps.find((file) => file.fileName.includes(".de-"));
    expect(JSON.parse(deMap!.source).imports[`#pmds/${key}`]).toBe(`/${deAsset!.fileName}`);

    const manifest = emitted.find((file) => file.fileName === "palamedes-split-manifest.json");
    const parsed = JSON.parse(manifest!.source);
    expect(parsed.locales).toEqual(["en", "de", "pseudo"]);
    expect(parsed.importMaps.de).toBe(deMap!.fileName);
    // Only chunks with bare message imports appear, so servers can preload
    // the mapped assets of the chunks they serve.
    expect(parsed.chunkImports).toEqual({ "assets/home-abc.js": [`#pmds/${key}`] });
  });

  it("emits an empty manifest for a client build without any messages", async () => {
    const { plugins, sidecarPlugin } = buildPlugins();
    const bundle = {
      "assets/index-abc.js": { type: "chunk", imports: ["assets/vendor.js"] },
      "assets/vendor.js": { type: "chunk", imports: [] },
    };
    const emitted = await emitImportMap(sidecarPlugin, "", bundle);

    // No sidecar assets, but one import map per locale and the manifest itself.
    expect(emitted.filter((file) => file.fileName.startsWith("assets/palamedes-m-"))).toHaveLength(
      0,
    );
    const maps = emitted.filter((file) => file.fileName.startsWith("assets/palamedes-importmap."));
    expect(maps).toHaveLength(3);
    for (const map of maps) {
      expect(JSON.parse(map.source)).toEqual({ imports: {} });
    }
    const manifest = emitted.find((file) => file.fileName === "palamedes-split-manifest.json");
    const parsed = JSON.parse(manifest!.source);
    expect(parsed.locales).toEqual(["en", "de", "pseudo"]);
    expect(Object.keys(parsed.importMaps)).toEqual(["en", "de", "pseudo"]);
    expect(parsed.chunkImports).toEqual({});
    expect(bundle["assets/index-abc.js"].imports).toEqual(["assets/vendor.js"]);

    // The output is deterministic across runs.
    expect(await emitImportMap(sidecarPlugin, "", bundle)).toEqual(emitted);

    // Static HTML stays as built: an empty import map has nothing to delay for.
    const htmlPlugin = plugins.find((plugin) => plugin.name === "palamedes:html-delivery");
    const html =
      '<html lang="en"><body><script type="module" src="/assets/index-abc.js"></script></body></html>';
    const outputs: Record<string, any> = {
      "palamedes-split-manifest.json": {
        type: "asset",
        fileName: "palamedes-split-manifest.json",
        source: manifest!.source,
      },
      "index.html": { type: "asset", fileName: "index.html", source: html },
    };
    for (const map of maps) {
      outputs[map.fileName] = { type: "asset", fileName: map.fileName, source: map.source };
    }
    const emitHtmlFile = vi.fn();
    const generateHtml =
      typeof htmlPlugin?.generateBundle === "function"
        ? htmlPlugin.generateBundle
        : htmlPlugin?.generateBundle?.handler;
    await generateHtml?.call(
      { emitFile: emitHtmlFile } as never,
      {} as never,
      outputs as never,
      false,
    );
    expect(outputs["index.html"].source).toBe(html);
    expect(emitHtmlFile).not.toHaveBeenCalled();
  });

  it("still skips the manifest for a server build without any messages", async () => {
    const { sidecarPlugin } = buildPlugins();
    const emitFile = vi.fn();

    await sidecarPlugin.generateBundle.call(
      { environment: { name: "ssr" }, emitFile, warn: vi.fn() } as never,
      {},
      {},
    );

    expect(emitFile).not.toHaveBeenCalled();
  });

  it.each([
    ["/app", "/app/"],
    ["/app/", "/app/"],
    ["https://cdn.example.com/app/", "https://cdn.example.com/app/"],
    ["/app", "/configured-by-another-plugin/"],
  ] as const)(
    "uses Vite's final base %s when generating import-map assets as %s",
    async (rawBase, finalBase) => {
      mocks.renderCatalogModule.mockImplementation((messages: Record<string, string>) =>
        nativeModuleShape(JSON.stringify(messages)),
      );
      const { key, sidecarPlugin } = await runSidecarLoad(
        ["id-a"],
        {},
        {
          pluginOptions: {},
          command: "build",
          rawBase,
          finalBase,
        },
      );

      const emitted = await emitImportMap(sidecarPlugin, key);
      const asset = emitted.find((file) => file.fileName.startsWith("assets/palamedes-m-"));
      const importMap = emitted.find((file) => file.fileName.includes("palamedes-importmap.en-"));
      const assetUrl = JSON.parse(importMap!.source).imports[`#pmds/${key}`];

      expect(assetUrl).toBe(`${finalBase}${asset!.fileName}`);
      expect(assetUrl).not.toContain("/appassets/");
      expect(assetUrl).not.toContain(".assets/");
    },
  );

  it.each(["./", "assets/"])(
    "rejects relative Vite base %s for import-map assets",
    async (finalBase) => {
      const { key, sidecarPlugin } = await runSidecarLoad(
        ["id-a"],
        {},
        {
          pluginOptions: {},
          command: "build",
          finalBase,
        },
      );

      await expect(emitImportMap(sidecarPlugin, key)).rejects.toThrow(
        `Relative base ${JSON.stringify(finalBase)} resolves import-map entries against each document URL and breaks on nested routes.`,
      );
    },
  );

  it("fails the import-map build on missing translations when configured", async () => {
    // The emitted assets are the only client-visible artifact of this binding,
    // so the gate has to hold here as well as on the embedded load path.
    mocks.compileCatalogArtifactSelected.mockReturnValue({
      messages: {},
      missing: [{ id: "id-a", message: "Hello" }],
      diagnostics: [],
      watchFiles: [],
      resolvedLocaleChain: [],
    });

    const { sidecarPlugin } = await runSidecarLoad(
      ["id-a"],
      {},
      {
        pluginOptions: { failOnMissing: true },
        command: "build",
      },
    );
    const emitFile = vi.fn();

    await expect(
      sidecarPlugin.generateBundle.call(
        { environment: { name: "client" }, emitFile, warn: vi.fn() } as never,
        {},
        {},
      ),
    ).rejects.toThrow(/Missing 1 translation\(s\) for locale en/);
    expect(emitFile).not.toHaveBeenCalled();
  });

  it("warns about incomplete import-map assets when missing is not fatal", async () => {
    mocks.renderCatalogModule.mockImplementation((messages: Record<string, string>) =>
      nativeModuleShape(JSON.stringify(messages)),
    );
    mocks.compileCatalogArtifactSelected.mockReturnValue({
      messages: {},
      missing: [{ id: "id-a", message: "Hello" }],
      diagnostics: [],
      watchFiles: [],
      resolvedLocaleChain: [],
    });

    const { sidecarPlugin } = await runSidecarLoad(
      ["id-a"],
      {},
      { pluginOptions: {}, command: "build" },
    );
    const warn = vi.fn();
    await sidecarPlugin.generateBundle.call(
      { environment: { name: "client" }, emitFile: vi.fn(), warn } as never,
      {},
      {},
    );

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("/repo/src/label.ts"));
  });

  it.each([
    ["the legacy SSR environment name", { name: "ssr" }, undefined],
    ["an RSC server consumer", { name: "rsc", config: { consumer: "server" } }, undefined],
    ["an SSR build without an environment context", undefined, true],
    ["an SSR entry build without an environment context", undefined, "src/entry-server.ts"],
  ])("skips asset emission for %s", async (_description, environment, buildSsr) => {
    const { sidecarPlugin } = await runSidecarLoad(
      ["id-a"],
      {},
      { pluginOptions: {}, command: "build", buildSsr },
    );
    const emitFile = vi.fn();
    await sidecarPlugin.generateBundle.call(
      {
        environment,
        emitFile,
      } as never,
      {},
      {},
    );

    expect(emitFile).not.toHaveBeenCalled();
  });

  it("emits assets for a legacy client build without an environment", async () => {
    mocks.renderCatalogModule.mockImplementation((messages: Record<string, string>) =>
      nativeModuleShape(JSON.stringify(messages)),
    );
    const { sidecarPlugin } = await runSidecarLoad(
      ["id-a"],
      {},
      { pluginOptions: {}, command: "build", buildSsr: false },
    );
    const emitFile = vi.fn();

    await sidecarPlugin.generateBundle.call({ emitFile, warn: vi.fn() } as never, {}, {});

    expect(emitFile).toHaveBeenCalled();
  });

  it.each([true, "src/entry-server.ts"])(
    "keeps a modern client environment client-side when the root build is SSR (%s)",
    async (buildSsr) => {
      mocks.renderCatalogModule.mockImplementation((messages: Record<string, string>) =>
        nativeModuleShape(JSON.stringify(messages)),
      );
      const { sidecarPlugin } = await runSidecarLoad(
        ["id-a"],
        {},
        { pluginOptions: {}, command: "build", buildSsr },
      );
      const emitFile = vi.fn();

      await sidecarPlugin.generateBundle.call(
        { environment: { name: "client" }, emitFile, warn: vi.fn() } as never,
        {},
        {},
      );

      expect(emitFile).toHaveBeenCalled();
    },
  );
});

async function runSidecarLoad(
  compiledIds: string[],
  context: Record<string, unknown> = {},
  setup: {
    pluginOptions?: Parameters<typeof palamedes>[0];
    command?: "build" | "serve";
    buildSsr?: boolean | string;
    rawBase?: string;
    finalBase?: string;
    sourceId?: string;
  } = {},
): Promise<{
  load: (id: string, loadOptions?: { ssr?: boolean }) => Promise<any>;
  key: string;
  transformedCode: string;
  addWatchFile: ReturnType<typeof vi.fn>;
  sidecarPlugin: any;
}> {
  mocks.transformPalamedesMacros.mockClear();
  mocks.compileCatalogArtifactSelected.mockClear();
  mocks.renderCatalogModule.mockClear();
  mocks.transformPalamedesMacros.mockReturnValue({
    code: "transformed",
    hasChanged: true,
    compiledIds,
    map: null,
  });
  const plugins = palamedes(setup.pluginOptions ?? {});
  const macroPlugin = plugins.find((plugin) => plugin.name === "palamedes:transform");
  const sidecarPlugin = plugins.find((plugin) => plugin.name === "palamedes:message-sidecars");
  const transform = transformHandler(macroPlugin?.transform);
  const load = sidecarPlugin?.load;
  if (typeof transform !== "function" || typeof load !== "function") {
    throw new TypeError("Expected transform and sidecar load hooks");
  }

  if (setup.command && typeof macroPlugin?.config === "function") {
    macroPlugin.config.call(
      {} as any,
      setup.rawBase === undefined ? ({} as any) : ({ base: setup.rawBase } as any),
      {
        command: setup.command,
        mode: setup.command === "serve" ? "development" : "production",
      } as any,
    );

    if (typeof macroPlugin.configResolved !== "function") {
      throw new TypeError("Expected transform configResolved hook");
    }
    macroPlugin.configResolved.call(
      {} as any,
      {
        base: setup.finalBase ?? setup.rawBase ?? "/",
        build: { ssr: setup.buildSsr },
      } as any,
    );
  }

  const transformed = (await transform.call(
    { error: vi.fn() } as never,
    'import { t } from "@palamedes/core/macro"\nexport const label = t`Hello`',
    setup.sourceId ?? "/repo/src/label.ts",
  )) as { code?: string } | null;
  const key = /virtual:palamedes-messages\/([0-9a-f]{12})/.exec(transformed?.code ?? "")?.[1];
  if (!key) {
    throw new Error("Expected a sidecar import in the transformed output");
  }

  const addWatchFile = vi.fn();
  const boundLoad = (id: string, loadOptions?: { ssr?: boolean }) =>
    Promise.resolve(
      load.call(
        {
          addWatchFile,
          error(message: unknown) {
            throw message instanceof Error ? message : new Error(String(message));
          },
          warn() {},
          ...context,
        } as any,
        id,
        loadOptions,
      ),
    );

  return {
    load: boundLoad,
    key,
    transformedCode: transformed?.code ?? "",
    addWatchFile,
    sidecarPlugin,
  };
}

function buildPlugins() {
  const plugins = palamedes({});
  const macroPlugin = plugins.find((plugin) => plugin.name === "palamedes:transform");
  if (typeof macroPlugin?.config === "function") {
    macroPlugin.config.call({} as any, {} as any, { command: "build", mode: "production" } as any);
  }
  if (typeof macroPlugin?.configResolved === "function") {
    macroPlugin.configResolved.call({} as any, { base: "/", build: { ssr: false } } as any);
  }
  const sidecarPlugin = plugins.find((plugin) => plugin.name === "palamedes:message-sidecars");
  return { plugins, sidecarPlugin: sidecarPlugin as any };
}

async function emitImportMap(
  sidecarPlugin: any,
  key: string,
  bundle: Record<string, { type: string; imports?: string[] }> = {
    "assets/home-abc.js": { type: "chunk", imports: [`#pmds/${key}`, "assets/vendor.js"] },
    "assets/vendor.js": { type: "chunk", imports: [] },
    "assets/style.css": { type: "asset" },
  },
) {
  const emitted: { fileName: string; source: string }[] = [];
  await sidecarPlugin.generateBundle.call(
    {
      environment: { name: "client" },
      emitFile: (file: { fileName: string; source: string }) => emitted.push(file),
    } as never,
    {},
    bundle,
  );
  return emitted;
}

function runMacroTransform(
  options: Parameters<typeof palamedes>[0] = {},
  command?: "build" | "serve",
  compiledIds: string[] = [],
  sourceId = "/repo/src/label.ts",
) {
  mocks.transformPalamedesMacros.mockClear();
  mocks.transformPalamedesMacros.mockReturnValue({
    code: "transformed",
    hasChanged: true,
    compiledIds,
    map: null,
  });
  const macroPlugin = palamedes(options).find((plugin) => plugin.name === "palamedes:transform");
  const transform = transformHandler(macroPlugin?.transform);

  if (command && typeof macroPlugin?.config === "function") {
    macroPlugin.config.call(
      {} as any,
      {} as any,
      { command, mode: command === "serve" ? "development" : "production" } as any,
    );
  }

  if (typeof transform !== "function") {
    throw new TypeError("Expected macro transform hook");
  }

  return transform.call(
    {
      error(message: unknown) {
        throw message instanceof Error ? message : new Error(String(message));
      },
    } as never,
    'import { t } from "@palamedes/core/macro"\nexport const label = t`Hello`',
    sourceId,
  );
}

async function runPoTransform(
  context: Record<string, unknown> = {},
  options: Parameters<typeof palamedes>[0] = {},
  sourceId = "/repo/src/locales/de.po",
) {
  const plugins = palamedes(options);
  const poLoader = plugins.find((plugin) => plugin.name === "palamedes:po-loader");
  const transform = poLoader?.transform;

  if (typeof transform !== "function") {
    throw new TypeError("Expected palamedes:po-loader transform hook");
  }

  return transform.call(
    {
      addWatchFile() {},
      ...context,
    } as any,
    "",
    sourceId,
  );
}

async function runMdxTransform(
  context: Record<string, unknown> = {},
  options: Parameters<typeof palamedes>[0] = {},
  command?: "build" | "serve",
  sourceId = "/repo/src/guide.mdx",
) {
  const plugins = palamedes(options);
  if (command) {
    const macroPlugin = plugins.find((plugin) => plugin.name === "palamedes:transform");
    if (typeof macroPlugin?.config === "function") {
      macroPlugin.config.call(
        {} as any,
        {} as any,
        { command, mode: command === "serve" ? "development" : "production" } as any,
      );
    }
  }
  const mdxPlugin = plugins.find((plugin) => plugin.name === "palamedes:mdx");
  const transform = transformHandler(mdxPlugin?.transform);

  if (typeof transform !== "function") {
    throw new TypeError("Expected palamedes:mdx transform hook");
  }

  return transform.call(
    {
      addWatchFile() {},
      error(message: unknown) {
        throw message instanceof Error ? message : new Error(String(message));
      },
      ...context,
    } as any,
    "# Welcome",
    sourceId,
  );
}

async function runMdxConfig(options: Parameters<typeof palamedes>[0] = {}) {
  const mdxPlugin = palamedes(options).find((plugin) => plugin.name === "palamedes:mdx");
  const config = mdxPlugin?.config;

  if (typeof config !== "function") {
    throw new TypeError("Expected palamedes:mdx config hook");
  }

  return config.call(
    {} as any,
    {} as any,
    {
      command: "build",
      mode: "production",
    } as any,
  );
}
