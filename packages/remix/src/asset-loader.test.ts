import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createAssetServer, type ModuleLoader } from "remix/assets";
import { SourceMapConsumer } from "source-map-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { transformPalamedesMacros } from "@palamedes/transform";

import {
  createPalamedesRemixAssetLoader,
  createPalamedesRemixCatalogAssetRegistry,
  PALAMEDES_REMIX_ASSET_PACKAGES,
  PALEMEDES_REMIX_ASSET_PACKAGES,
} from "./index";

const assetLoadContext = {
  conditions: ["browser", "import", "module", "default"],
  format: "module",
  importAttributes: {},
  moduleUrl: "/assets/app/public/module.js",
};

const tempDirectories: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("createPalamedesRemixAssetLoader", () => {
  it("allows every package required by transformed and bootstrapped browser modules", () => {
    expect(PALAMEDES_REMIX_ASSET_PACKAGES).toStrictEqual([
      "@palamedes/core",
      "@palamedes/runtime",
      "@palamedes/remix",
    ]);
    expect(PALEMEDES_REMIX_ASSET_PACKAGES).toBe(PALAMEDES_REMIX_ASSET_PACKAGES);
  });

  it.each([
    [
      "TypeScript",
      "greeting.ts",
      [
        'import { t } from "@palamedes/core/macro"',
        "export function greeting(name: string): string {",
        "  return t`Hello ${name}`",
        "}",
      ].join("\n"),
    ],
    [
      "JavaScript",
      "greeting.js",
      [
        'import { t } from "@palamedes/core/macro"',
        "export function greeting(name) {",
        "  return t`Hello ${name}`",
        "}",
      ].join("\n"),
    ],
  ])(
    "transforms %s browser modules after Remix compilation",
    async (_language, fileName, source) => {
      const fixture = createAssetFixture(fileName, source);
      const assetServer = createAssetServer({
        rootDir: fixture.rootDir,
        basePath: "/assets",
        allowFiles: ["app/**/public/**"],
        allowPackages: [...PALAMEDES_REMIX_ASSET_PACKAGES],
        watch: false,
        scripts: { loaders: [createPalamedesRemixAssetLoader()] },
      });

      try {
        const response = await assetServer.fetch(
          new Request(`http://example.test/assets/app/public/${fileName}`),
        );
        expect(response?.status).toBe(200);
        const compiled = await response?.text();

        expect(compiled).toContain("getI18n()._(");
        expect(compiled).not.toContain("@palamedes/core/macro");
        expect(compiled).not.toContain('from "@palamedes/runtime"');
        expect(compiled).toMatch(/from ["']\/assets\/npm\/%40palamedes\/runtime\//u);
        if (fileName.endsWith(".ts")) {
          expect(compiled).not.toContain("name: string");
        }
      } finally {
        await assetServer.close();
      }
    },
  );

  it("wraps transform errors with the browser module path", () => {
    const loader = createPalamedesRemixAssetLoader();
    const url = pathToFileURL("/repo/app/public/broken.ts").href;

    expect(() =>
      loader(url, assetLoadContext, () => ({
        format: "module",
        source: [
          'import { t } from "@palamedes/core/macro"',
          "export function greeting() {",
          '  return t({ id: "explicit", message: "Hello" })',
          "}",
        ].join("\n"),
      })),
    ).toThrow(
      /Failed to transform Palamedes macros in \/repo\/app\/public\/broken\.ts:.*Explicit message ids/u,
    );
  });

  it("does not execute a lazy module body when its catalog fragment rejects", async () => {
    const loader = createPalamedesRemixAssetLoader({
      catalogAssets: {
        register: () => "fragment-key",
        sidecarUrl: () => "/assets/__palamedes/catalog-fragments/fragment-key.js",
        serve() {},
        invalidate() {},
      },
    });
    const loaded = loader(
      pathToFileURL("/repo/app/public/rejected.ts").href,
      assetLoadContext,
      () => ({
        format: "module",
        source: [
          'import { t } from "@palamedes/core/macro";',
          "globalThis.__palamedesRejectedModuleBody = (globalThis.__palamedesRejectedModuleBody ?? 0) + 1;",
          "export function message() { return t`Hello`; }",
        ].join("\n"),
      }),
    );
    const source = String(loaded.source)
      .replace(
        /^import\{defineCompiledCatalog as __palamedesDefineCompiledCatalog\}from"@palamedes\/core\/compiled";/u,
        "const __palamedesDefineCompiledCatalog=(value)=>value;\n",
      )
      .replace(
        /import\{getI18n as __palamedesGetI18n,loadRegisteredMessages as __palamedesLoadRegisteredMessages,registerMessageLoaderGroup as __palamedesRegisterMessageLoaderGroup\}from"@palamedes\/runtime";\n/u,
        'const __palamedesGetI18n=()=>{throw new Error("No active client i18n instance")};const __palamedesLoadRegisteredMessages=async()=>{};const __palamedesRegisterMessageLoaderGroup=()=>{};\n',
      )
      .replace(/^import\s+(?:\{[^;]+\}|[^;]+)\s+from\s+["'][^"']+["'];\s*\n?/gmu, "");
    const rejectedUrl = `data:text/javascript,${encodeURIComponent('throw new Error("fragment failed")')}`;
    const executable = source.replace(
      /new URL\(.+?,document\.baseURI\)/u,
      JSON.stringify(rejectedUrl),
    );
    const testGlobal = globalThis as typeof globalThis & {
      __palamedesRejectedModuleBody?: number;
    };
    testGlobal.__palamedesRejectedModuleBody = 0;
    const globalRecord = globalThis as unknown as Record<string, unknown>;
    globalRecord.document = {
      baseURI: "https://example.test/",
      documentElement: { lang: "de" },
    } as unknown as Document;
    await expect(import(`data:text/javascript,${encodeURIComponent(executable)}`)).rejects.toThrow(
      "fragment failed",
    );
    expect(testGlobal.__palamedesRejectedModuleBody).toBe(0);
    delete testGlobal.__palamedesRejectedModuleBody;
    delete globalRecord.document;
  });

  it("preserves the original transform error when an incoming source map is malformed", () => {
    const loader = createPalamedesRemixAssetLoader();
    const url = pathToFileURL("/repo/app/public/broken-map.ts").href;
    const malformedMap = Buffer.from("not-json", "utf8").toString("base64");

    expect(() =>
      loader(url, assetLoadContext, () => ({
        format: "module",
        source: [
          'import { t } from "@palamedes/core/macro"',
          "export function greeting(input) {",
          "  return t({ message: input.message })",
          "}",
          `//# sourceMappingURL=data:application/json;base64,${malformedMap}`,
        ].join("\n"),
      })),
    ).toThrow(/Unsupported `t` macro usage at \/repo\/app\/public\/broken-map\.ts:3:/u);
  });

  it("remaps post-compile transform diagnostics to the authored TypeScript source", async () => {
    const source = [
      'import { t } from "@palamedes/core/macro"',
      "",
      "type Greeting = { message: string }",
      "",
      "export function greeting(input: Greeting) {",
      '  const prefix: string = "Hello"',
      "  return t({ message: input.message, context: prefix })",
      "}",
    ].join("\n");
    const fixture = createAssetFixture("diagnostic.ts", source);
    let compilationError: unknown;
    const assetServer = createAssetServer({
      rootDir: fixture.rootDir,
      basePath: "/assets",
      allowFiles: ["app/**/public/**"],
      allowPackages: [...PALAMEDES_REMIX_ASSET_PACKAGES],
      sourceMaps: "inline",
      watch: false,
      scripts: { loaders: [createPalamedesRemixAssetLoader()] },
      onError(error) {
        compilationError = error;
        return new Response("Compilation failed", { status: 500 });
      },
    });

    try {
      const response = await assetServer.fetch(
        new Request("http://example.test/assets/app/public/diagnostic.ts"),
      );

      expect(response?.status).toBe(500);
      expect(String(compilationError)).toContain(`${fixture.modulePath}:7:`);
      expect(String(compilationError)).not.toMatch(
        new RegExp(`${escapeRegExp(fixture.modulePath)}:[1-6]:\\d+`, "u"),
      );
    } finally {
      await assetServer.close();
    }
  });

  it("composes Palamedes mappings with Remix's map back to authored TypeScript", async () => {
    const source = [
      'import { t } from "@palamedes/core/macro"',
      "",
      "type Greeting = { name: string }",
      "",
      "export function greeting(input: Greeting): string {",
      "  return t`Hello ${input.name}`",
      "}",
    ].join("\n");
    const fixture = createAssetFixture("mapped.ts", source);
    const assetServer = createAssetServer({
      rootDir: fixture.rootDir,
      basePath: "/assets",
      allowFiles: ["app/**/public/**"],
      allowPackages: [...PALAMEDES_REMIX_ASSET_PACKAGES],
      sourceMaps: "external",
      sourceMapSourcePaths: "absolute",
      watch: false,
      scripts: { loaders: [createPalamedesRemixAssetLoader()] },
    });

    try {
      const moduleUrl = "http://example.test/assets/app/public/mapped.ts";
      const response = await assetServer.fetch(new Request(moduleUrl));
      const compiled = await response?.text();
      const mapResponse = await assetServer.fetch(new Request(`${moduleUrl}.map`));
      const map = await mapResponse?.json();

      expect(response?.status).toBe(200);
      expect(mapResponse?.status).toBe(200);
      expect(compiled).toContain("getI18n()._(");
      const generated = findGeneratedPosition(compiled ?? "", "getI18n()._(");
      const original = new SourceMapConsumer(map).originalPositionFor(generated);
      expect(original).toMatchObject({
        source: fixture.modulePath,
        line: 6,
      });
    } finally {
      await assetServer.close();
    }
  });

  it("keeps the transformed module and source map valid through production minification", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const fixture = createAssetFixture(
      "production.ts",
      [
        'import { t } from "@palamedes/core/macro"',
        "export function greeting(name: string) {",
        "  return t`Production hello ${name}`",
        "}",
      ].join("\n"),
    );
    const assetServer = createAssetServer({
      rootDir: fixture.rootDir,
      basePath: "/assets",
      allowFiles: ["app/**/public/**"],
      allowPackages: [...PALAMEDES_REMIX_ASSET_PACKAGES],
      minify: true,
      sourceMaps: "external",
      watch: false,
      scripts: { loaders: [createPalamedesRemixAssetLoader({ keepSourceFallbacks: true })] },
    });

    try {
      const moduleUrl = "http://example.test/assets/app/public/production.ts";
      const response = await assetServer.fetch(new Request(moduleUrl));
      const compiled = await response?.text();
      const mapResponse = await assetServer.fetch(new Request(`${moduleUrl}.map`));
      const map = await mapResponse?.json();

      expect(response?.status).toBe(200);
      expect(compiled).toContain("Production hello");
      expect(compiled).not.toContain("@palamedes/core/macro");
      expect(mapResponse?.status).toBe(200);
      expect(map).toMatchObject({ version: 3 });
      expect(map.mappings).not.toBe("");
    } finally {
      await assetServer.close();
    }
  });

  it("re-runs the loader after a watched macro module changes without restarting", async () => {
    const firstSource = [
      'import { t } from "@palamedes/core/macro"',
      "export function greeting() { return t`First browser message` }",
    ].join("\n");
    const secondSource = firstSource.replace("First browser message", "Second browser message");
    const fixture = createAssetFixture("watched.ts", firstSource);
    const transform = createPalamedesRemixAssetLoader({ keepSourceFallbacks: true });
    let loaderCalls = 0;
    const countingLoader: ModuleLoader = (url, context, nextLoad) => {
      loaderCalls += 1;
      return transform(url, context, nextLoad);
    };
    let sourceWatchRegistered = false;
    const assetServer = createAssetServer({
      rootDir: fixture.rootDir,
      basePath: "/assets",
      allowFiles: ["app/**/public/**"],
      allowPackages: [...PALAMEDES_REMIX_ASSET_PACKAGES],
      hmr: () => ({
        url: "http://example.test/assets/__hmr/events",
        close() {},
        onFileEvents() {
          return () => {};
        },
        updateWatchedFiles(delta) {
          if (delta.add.includes(fixture.modulePath)) {
            sourceWatchRegistered = true;
          }
        },
      }),
      watch: { poll: true, pollInterval: 20 },
      scripts: { loaders: [countingLoader] },
    });

    try {
      const moduleUrl = "http://example.test/assets/app/public/watched.ts";
      const firstResponse = await assetServer.fetch(new Request(moduleUrl));
      const firstCompiled = await firstResponse?.text();
      const etag = firstResponse?.headers.get("etag") ?? "";

      expect(firstCompiled).toContain("First browser message");
      await waitFor(() => sourceWatchRegistered);

      const cachedResponse = await assetServer.fetch(
        new Request(moduleUrl, { headers: { "if-none-match": etag } }),
      );
      expect(cachedResponse?.status).toBe(304);
      const loaderCallsBeforeChange = loaderCalls;

      writeFileSync(fixture.modulePath, secondSource);
      let changedResponse: Response | null = null;
      let changedCompiled = "";
      await waitFor(async () => {
        changedResponse = await assetServer.fetch(
          new Request(moduleUrl, { headers: { "if-none-match": etag } }),
        );
        if (changedResponse?.status !== 200) {
          return false;
        }
        changedCompiled = await changedResponse.text();
        return changedCompiled.includes("Second browser message");
      });

      expect(changedCompiled).toContain("Second browser message");
      expect(changedCompiled).not.toContain("First browser message");
      expect(loaderCalls).toBeGreaterThan(loaderCallsBeforeChange);
    } finally {
      await assetServer.close();
    }
  }, 10_000);

  it("targets the Remix UI compiled runtime for lowered rich messages", () => {
    const loader = createPalamedesRemixAssetLoader();
    const loaded = loader(pathToFileURL("/repo/app/public/rich.js").href, assetLoadContext, () => ({
      format: "module",
      source: [
        'import { Trans as Message } from "@palamedes/remix/macro"',
        'import { jsxs } from "remix/ui/jsx-runtime"',
        'export const view = jsxs(Message, { children: ["Hello ", name] })',
      ].join("\n"),
    }));

    expect(String(loaded.source)).toContain('import { Trans } from "@palamedes/remix/compiled"');
    expect(String(loaded.source)).toContain('jsxs(Trans, { id: "');
    expect(String(loaded.source)).not.toContain("@palamedes/remix/macro");
  });

  it("registers a selected executable sidecar from the module's compiled IDs", () => {
    const registry = {
      register: vi.fn().mockReturnValue("fragment-key"),
      sidecarUrl: vi.fn().mockReturnValue("/assets/__palamedes/catalog-fragments/fragment-key.js"),
      serve: vi.fn(),
      invalidate: vi.fn(),
    };
    const loader = createPalamedesRemixAssetLoader({ catalogAssets: registry });
    const loaded = loader(
      pathToFileURL("/repo/app/public/fragment.ts").href,
      assetLoadContext,
      () => ({
        format: "module",
        source:
          'import { t } from "@palamedes/core/macro"; globalThis.__fragmentSideEffect = true; export function text() { return t`Fragment`; }',
      }),
    );

    expect(registry.register).toHaveBeenCalledWith(
      "/repo/app/public/fragment.ts",
      expect.arrayContaining([expect.any(String)]),
    );
    expect(String(loaded.source)).toContain('__palamedesRegisterMessageLoaderGroup("fragment-key"');
    expect(String(loaded.source)).toContain(
      'new URL("/assets/__palamedes/catalog-fragments/fragment-key.js?fragment=1&locale="',
    );
    expect(String(loaded.source).indexOf("__palamedesRegisterMessageLoaderGroup")).toBeLessThan(
      String(loaded.source).indexOf("globalThis.__fragmentSideEffect"),
    );
  });

  it("serves locale fragments selected by a module and invalidates stale generations", async () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), "palamedes-remix-fragments-"));
    tempDirectories.push(rootDir);
    mkdirSync(path.join(rootDir, "app", "locales"), { recursive: true });
    writeFileSync(
      path.join(rootDir, "palamedes.yaml"),
      [
        "locales: [en, de]",
        "source-locale: en",
        "catalogs:",
        "  - path: app/locales/{locale}",
        "    include: [app/**/*.ts]",
      ].join("\n"),
    );
    const deCatalogPath = path.join(rootDir, "app", "locales", "de.po");
    writeFileSync(
      deCatalogPath,
      'msgid ""\nmsgstr ""\n\nmsgid "Greeting"\nmsgstr "Hallo"\n\nmsgid "Other"\nmsgstr "Andere"\n',
    );
    writeFileSync(
      path.join(rootDir, "app", "locales", "en.po"),
      'msgid ""\nmsgstr ""\n\nmsgid "Greeting"\nmsgstr "Hello"\n\nmsgid "Other"\nmsgstr "Other"\n',
    );
    const sourcePath = path.join(rootDir, "app", "routes", "fragment.ts");
    mkdirSync(path.dirname(sourcePath), { recursive: true });
    writeFileSync(sourcePath, "export const fragment = true;\n");
    const registry = createPalamedesRemixCatalogAssetRegistry({ cwd: rootDir });
    const compiledIds = transformPalamedesMacros(
      'import { t } from "@palamedes/core/macro"; export function text() { return t`Greeting`; }',
      sourcePath,
    ).compiledIds;
    const firstKey = registry.register(sourcePath, compiledIds);
    const sidecar = registry.serve(
      new Request(`https://example.test/assets/__palamedes/catalog-fragments/${firstKey}.js`),
    );
    expect(sidecar?.status).toBe(200);
    const sidecarSource = await sidecar?.text();
    expect(sidecarSource).toContain("registerMessageLoaderGroup");
    expect(sidecarSource).toContain("document.documentElement.lang");
    expect(sidecarSource).not.toContain("Hallo");

    const fragment = registry.serve(
      new Request(
        `https://example.test/assets/__palamedes/catalog-fragments/${firstKey}.js?fragment=1&locale=de`,
      ),
    );
    const fragmentSource = await fragment?.text();
    expect(fragment?.status).toBe(200);
    expect(fragmentSource).toContain("Hallo");
    expect(fragmentSource).not.toContain("Andere");
    expect(fragmentSource).not.toContain("msgid");

    writeFileSync(
      deCatalogPath,
      'msgid ""\nmsgstr ""\n\nmsgid "Greeting"\nmsgstr "Hallo aktualisiert"\n\nmsgid "Other"\nmsgstr "Andere"\n',
    );
    const catalogChangedKey = registry.register(sourcePath, compiledIds);
    expect(catalogChangedKey).not.toBe(firstKey);
    expect(
      registry.serve(
        new Request(`https://example.test/assets/__palamedes/catalog-fragments/${firstKey}.js`),
      )?.status,
    ).toBe(404);

    const secondKey = registry.register(sourcePath, ["stale-generation-proof"]);
    expect(secondKey).not.toBe(firstKey);
    expect(
      registry.serve(
        new Request(`https://example.test/assets/__palamedes/catalog-fragments/${firstKey}.js`),
      )?.status,
    ).toBe(404);
    expect(
      registry.serve(
        new Request(`https://example.test/assets/__palamedes/catalog-fragments/${secondKey}.js`),
      )?.status,
    ).toBe(200);
  });

  it("honors browser-specific include and exclude filters", () => {
    const source = [
      'import { t } from "@palamedes/core/macro"',
      "export function greeting() { return t`Hello` }",
    ].join("\n");
    const loader = createPalamedesRemixAssetLoader({
      include: /[/\\]public[/\\].*\.js$/u,
      exclude: /[/\\]public[/\\]excluded[/\\]/u,
    });
    const load = (filePath: string) =>
      loader(pathToFileURL(filePath).href, assetLoadContext, () => ({
        format: "module",
        source,
      }));

    expect(String(load("/repo/app/public/included.js").source)).toContain("getI18n()._(");
    expect(load("/repo/app/private/not-included.js").source).toBe(source);
    expect(load("/repo/app/public/excluded/skip.js").source).toBe(source);
  });
});

function createAssetFixture(
  fileName: string,
  source: string,
): { modulePath: string; rootDir: string } {
  const rootDir = mkdtempSync(path.join(tmpdir(), "palamedes-remix-assets-"));
  tempDirectories.push(rootDir);
  const publicDirectory = path.join(rootDir, "app", "public");
  const palamedesPackages = path.join(rootDir, "node_modules", "@palamedes");
  const corePath = path.resolve(import.meta.dirname, "../..", "core");
  const runtimePath = path.resolve(import.meta.dirname, "../..", "runtime");
  const installedCorePath = path.join(palamedesPackages, "core");
  const installedRuntimePath = path.join(palamedesPackages, "runtime");
  const installedRemixIntegrationPath = path.join(palamedesPackages, "remix");
  mkdirSync(publicDirectory, { recursive: true });
  mkdirSync(installedCorePath, { recursive: true });
  mkdirSync(installedRuntimePath, { recursive: true });
  mkdirSync(installedRemixIntegrationPath, { recursive: true });
  const modulePath = path.join(publicDirectory, fileName);
  writeFileSync(modulePath, source);
  copyFileSync(path.join(corePath, "package.json"), path.join(installedCorePath, "package.json"));
  cpSync(path.join(corePath, "dist"), path.join(installedCorePath, "dist"), {
    recursive: true,
  });
  copyFileSync(
    path.join(runtimePath, "package.json"),
    path.join(installedRuntimePath, "package.json"),
  );
  cpSync(path.join(runtimePath, "dist"), path.join(installedRuntimePath, "dist"), {
    recursive: true,
  });
  writeFileSync(
    path.join(installedRemixIntegrationPath, "package.json"),
    JSON.stringify({
      name: "@palamedes/remix",
      type: "module",
      exports: { "./compiled": "./compiled.js" },
    }),
  );
  return { modulePath: realpathSync(modulePath), rootDir };
}

function findGeneratedPosition(source: string, needle: string): { column: number; line: number } {
  const offset = source.indexOf(needle);
  expect(offset).toBeGreaterThanOrEqual(0);
  const before = source.slice(0, offset);
  const lines = before.split("\n");
  return { line: lines.length, column: lines.at(-1)?.length ?? 0 };
}

async function waitFor(check: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for Remix asset invalidation");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
