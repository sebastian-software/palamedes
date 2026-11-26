import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

import { describe, expect, it, vi } from "vitest";

import {
  bindClientCatalogPermutationsAt,
  resolveRenderLocale,
  signClientCatalogLocaleHeader,
} from "./client-catalog-binding";
import {
  type ChunkGraph,
  affectedChunks,
  assertNoBootstrapChunks,
  assertChunkCoverage,
  chunkReferences,
  compiledRouteHasOptionalRootLocale,
  emitClientCatalogPermutations,
  filterLoadableManifest,
  inlineMessageExpression,
  renderManifestAdapter,
  renderVariants,
  routeHasOptionalRootLocale,
  variantPath,
} from "./client-catalog-permutations";

const marker = (key: string) =>
  `"pmds-next:${key}:${Buffer.from(JSON.stringify({ source: "src/a.tsx", ids: ["x"] })).toString("base64url")}"`;
const KEY_A = "aaaaaaaaaaaa";
const KEY_B = "bbbbbbbbbbbb";

function graph(entries: Record<string, string>): ChunkGraph {
  const known = new Set(Object.keys(entries));
  return new Map(
    Object.entries(entries).map(([key, source]) => [
      key,
      { source, references: chunkReferences(source, known) },
    ]),
  );
}

describe("affected chunk closure", () => {
  it("finds chunk literals that name known chunks only", () => {
    const known = new Set(["static/chunks/a.js", "static/chunks/b.js"]);
    expect(
      chunkReferences(
        `e.l("static/chunks/a.js"); e.l('static/chunks/b.js'); "static/chunks/c.js"; "static/chunks/a.js.map"`,
        known,
      ),
    ).toEqual(["static/chunks/a.js", "static/chunks/b.js"]);
  });

  it("includes importers of marked chunks transitively, not their siblings", () => {
    const chunks = graph({
      "static/chunks/leaf.js": `x(${marker(KEY_A)})`,
      "static/chunks/mid.js": `e.l("static/chunks/leaf.js")`,
      "static/chunks/top.js": `e.l("static/chunks/mid.js")`,
      "static/chunks/other.js": `e.l("static/chunks/top-unrelated.js")`,
    });
    expect([...affectedChunks(chunks, ["static/chunks/leaf.js"])].sort()).toEqual([
      "static/chunks/leaf.js",
      "static/chunks/mid.js",
      "static/chunks/top.js",
    ]);
  });
});

describe("variant rendering", () => {
  const messages = new Map([
    [KEY_A, '{"x":"Hallo"}'],
    [KEY_B, '{"y":"Welt"}'],
  ]);

  it("names a copy by locale and content hash", () => {
    const hash = createHash("sha256").update("body").digest("hex").slice(0, 8);
    expect(variantPath("static/chunks/x.js", "de", "body")).toBe(`static/chunks/x.de-${hash}.js`);
  });

  it("inlines messages, rewrites importer literals to the hashed copies, and drops the map pointer", () => {
    const chunks = graph({
      "static/chunks/leaf.js": `f(${marker(KEY_A)}, ${marker(KEY_B)});\n//# sourceMappingURL=leaf.js.map`,
      "static/chunks/top.js": `g(${marker(KEY_A)}); Promise.all(["static/chunks/leaf.js"].map(t=>e.l(t)))`,
    });
    const affected = affectedChunks(chunks, ["static/chunks/leaf.js", "static/chunks/top.js"]);
    const variants = renderVariants(chunks, affected, "de", messages);
    const leaf = variants.get("static/chunks/leaf.js")!;
    expect(leaf.body).toBe('f({"x":"Hallo"}, {"y":"Welt"});\n');
    expect(leaf.path).toBe(variantPath("static/chunks/leaf.js", "de", leaf.body));
    const top = variants.get("static/chunks/top.js")!;
    expect(top.body).toBe(`g({"x":"Hallo"}); Promise.all(["${leaf.path}"].map(t=>e.l(t)))`);
    expect(top.body).not.toContain("pmds-next:");
  });

  it("hashes a leaf by its messages, so a translation change renames the leaf and its importer only", () => {
    const chunks = graph({
      "static/chunks/leaf.js": `f(${marker(KEY_A)})`,
      "static/chunks/top.js": `e.l("static/chunks/leaf.js")`,
      "static/chunks/alone.js": `f(${marker(KEY_B)})`,
    });
    const affected = affectedChunks(chunks, ["static/chunks/leaf.js", "static/chunks/alone.js"]);
    const before = renderVariants(chunks, affected, "de", messages);
    const after = renderVariants(
      chunks,
      affected,
      "de",
      new Map([...messages, [KEY_A, '{"x":"Servus"}']]),
    );
    expect(after.get("static/chunks/leaf.js")!.path).not.toBe(
      before.get("static/chunks/leaf.js")!.path,
    );
    expect(after.get("static/chunks/top.js")!.path).not.toBe(
      before.get("static/chunks/top.js")!.path,
    );
    expect(after.get("static/chunks/alone.js")!.path).toBe(
      before.get("static/chunks/alone.js")!.path,
    );
  });

  it("rejects a cycle through affected chunks", () => {
    const chunks = graph({
      "static/chunks/a.js": `f(${marker(KEY_A)}); e.l("static/chunks/b.js")`,
      "static/chunks/b.js": `e.l("static/chunks/a.js")`,
    });
    const affected = affectedChunks(chunks, ["static/chunks/a.js"]);
    expect(() => renderVariants(chunks, affected, "de", messages)).toThrow(/cycle/u);
  });

  it("renders compiled messages as one expression", () => {
    const expression = inlineMessageExpression({
      a: "Hallo",
      b: "{n, plural, one {# Tag} other {# Tage}}",
    });
    const value = vm.runInNewContext(expression) as Record<string, unknown>;
    expect(value.a).toBe("Hallo");
    expect(typeof value.b).toBe("function");
  });
});

describe("build-time rejections", () => {
  it("rejects translated bootstrap chunks", () => {
    const buildManifest = JSON.stringify({ rootMainFiles: ["static/chunks/boot.js"] });
    expect(() =>
      assertNoBootstrapChunks(buildManifest, new Set(["static/chunks/boot.js"])),
    ).toThrow(/bootstrap/u);
    expect(() =>
      assertNoBootstrapChunks(buildManifest, new Set(["static/chunks/page.js"])),
    ).not.toThrow();
  });

  it("drops affected JavaScript hints from the loadable manifest and keeps CSS", () => {
    const manifest = {
      "x -> ./Lazy": { id: 1, files: ["static/chunks/lazy.js", "static/css/lazy.css"] },
    };
    expect(filterLoadableManifest(manifest, new Set(["static/chunks/lazy.js"]))).toBe(1);
    expect(manifest["x -> ./Lazy"].files).toEqual(["static/css/lazy.css"]);
    expect(() => filterLoadableManifest({ broken: {} }, new Set())).toThrow(/shape/u);
  });
});

describe("manifest adapter", () => {
  const variants = {
    "static/chunks/page.js": ["static/chunks/page.de-1.js", "static/chunks/page.en-2.js"],
  };
  function evaluate() {
    const manifest = `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};
globalThis.__RSC_MANIFEST["/[locale]/page"] = ${JSON.stringify({
      clientModules: {
        a: { id: 1, chunks: ["/_next/static/chunks/page.js?dpl=d1"], name: "*" },
        b: { id: 2, chunks: ["/_next/static/chunks/other.js"], name: "*" },
      },
      entryJSFiles: { layout: ["static/chunks/page.js", "static/chunks/shared.js"] },
    })};`;
    const context: Record<string, unknown> = { process: { env: {} } };
    vm.runInNewContext(manifest + renderManifestAdapter(["de", "en"], "en", variants), context);
    const route = (
      context.__RSC_MANIFEST as Record<
        string,
        Record<string, Record<string, Record<string, unknown>>>
      >
    )["/[locale]/page"]!;
    return { context, route };
  }

  it("reports only arrays the adapter replaces, including constructed paths", () => {
    const manifest = `globalThis.__RSC_MANIFEST = { route: {
      chunks: ["/_next/static/chunks/" + "page.js?dpl=example"],
      ignored: "static/chunks/page.js"
    } };`;
    const coverage = vm.runInNewContext(
      manifest + renderManifestAdapter(["de", "en"], "en", variants),
    );
    expect(coverage).toEqual(["static/chunks/page.js"]);
    const uncovered = vm.runInNewContext(
      `globalThis.__RSC_MANIFEST = { route: { ignored: "static/chunks/page.js" } };${renderManifestAdapter(["de", "en"], "en", variants)}`,
    );
    expect(uncovered).toEqual([]);
    expect(() =>
      assertChunkCoverage(new Set(["static/chunks/unrelated.js"]), new Set(coverage)),
    ).toThrow(/unrelated\.js/u);
  });

  it("hides affected arrays from enumeration and fails an unbound read", () => {
    const { route } = evaluate();
    expect(Object.keys(route.clientModules!.a!)).toEqual(["id", "name"]);
    expect(Object.keys(route.entryJSFiles!)).toEqual([]);
    expect(() => route.clientModules!.a!.chunks).toThrow(/bound locale resolver/u);
    expect(route.clientModules!.b!.chunks).toEqual(["/_next/static/chunks/other.js"]);
  });

  it("returns the bound locale's table with prefixes and queries kept", () => {
    const { context, route } = evaluate();
    let locale = "de";
    (
      context.__PALAMEDES_CLIENT_CATALOG_BIND as (
        fn: (locales: string[], fallback: string) => string,
      ) => void
    )((locales, fallback) => {
      expect(locales).toEqual(["de", "en"]);
      expect(fallback).toBe("en");
      return locale;
    });
    expect(route.clientModules!.a!.chunks).toEqual(["/_next/static/chunks/page.de-1.js?dpl=d1"]);
    expect(route.entryJSFiles!.layout).toEqual([
      "static/chunks/page.de-1.js",
      "static/chunks/shared.js",
    ]);
    locale = "en";
    expect(route.entryJSFiles!.layout).toEqual([
      "static/chunks/page.en-2.js",
      "static/chunks/shared.js",
    ]);
    locale = "fr";
    expect(() => route.entryJSFiles!.layout).toThrow(/no chunk permutation/u);
  });
});

describe("locale resolution", () => {
  const locales = ["de", "en"];
  type Render = Parameters<typeof resolveRenderLocale>[2];
  type Unit = Parameters<typeof resolveRenderLocale>[3];
  const render = (route: string) => ({ route }) as unknown as Render;
  const unit = (fields: Record<string, unknown>) => fields as unknown as Unit;
  const header = (locale: string) => new Headers({ "x-palamedes-locale": locale });

  it("prefers the root param named locale over an untrusted incoming header by default", () => {
    expect(
      resolveRenderLocale(
        locales,
        "en",
        undefined,
        unit({ rootParams: { locale: "de" }, headers: header("en") }),
      ),
    ).toBe("de");
    expect(
      resolveRenderLocale(
        locales,
        "en",
        undefined,
        unit({ rootParams: { locale: "zz" }, headers: header("de") }),
      ),
    ).toBe("en");
    // Catch-all and optional catch-all `locale` root params must not fall
    // through to an untrusted header, including Next's store shape for an
    // omitted `[[...locale]]` segment (where `rootParams` omits the key and
    // `render.route` declares `[[...locale]]`).
    expect(
      resolveRenderLocale(
        locales,
        "en",
        undefined,
        unit({ rootParams: { locale: ["de"] }, headers: header("de") }),
      ),
    ).toBe("en");
    expect(
      resolveRenderLocale(
        locales,
        "en",
        render("/[[...locale]]"),
        unit({ rootParams: {}, headers: header("de") }),
      ),
    ).toBe("en");
    expect(
      resolveRenderLocale(
        locales,
        "en",
        render("/(marketing)/[[...locale]]"),
        unit({ rootParams: {}, headers: header("de") }),
      ),
    ).toBe("en");
    // A nested optional locale segment below the root layout (for example
    // `app/layout.tsx` + `app/shop/[[...locale]]/page.tsx`) is not a root
    // param, so `route-first` still falls back to the Proxy header.
    const secret = "nested-route-secret";
    expect(
      resolveRenderLocale(
        locales,
        "en",
        render("/shop/[[...locale]]"),
        unit({ rootParams: {}, headers: header(signClientCatalogLocaleHeader("de", secret)) }),
        { headerSecret: secret },
      ),
    ).toBe("de");
    expect(
      resolveRenderLocale(
        locales,
        "en",
        render("/[[...locale]]"),
        unit({ rootParams: {}, headers: header(signClientCatalogLocaleHeader("de", secret)) }),
        { headerSecret: secret, optionalRootLocale: false },
      ),
    ).toBe("de");
    expect(
      resolveRenderLocale(
        locales,
        "en",
        render("/shop/[[...locale]]"),
        unit({ rootParams: {}, headers: header(signClientCatalogLocaleHeader("de", secret)) }),
        { headerSecret: secret, optionalRootLocale: true },
      ),
    ).toBe("en");
    // Route-tree layout detection distinguishes root vs nested optional locale
    // layouts regardless of whether the layout has client JS/CSS entries.
    const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "palamedes-root-layout-tree-"));
    try {
      const writeLayout = (project: string, relativePath: string) => {
        const target = path.join(fixtureRoot, project, relativePath);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(
          target,
          "export default function Layout({ children }) { return children; }\n",
        );
      };

      // Server-only root layout at app/shop/[[...locale]]/layout.jsx (no app/layout.jsx).
      writeLayout("nested-root", "app/shop/[[...locale]]/layout.jsx");
      expect(
        routeHasOptionalRootLocale(
          path.join(fixtureRoot, "nested-root"),
          "shop/[[...locale]]/page_client-reference-manifest.js",
        ),
      ).toBe(true);

      // Root layout at app/layout.jsx above app/shop/[[...locale]]/page.jsx.
      writeLayout("top-layout", "app/layout.jsx");
      writeLayout("top-layout", "app/shop/[[...locale]]/layout.jsx");
      expect(
        routeHasOptionalRootLocale(
          path.join(fixtureRoot, "top-layout"),
          "shop/[[...locale]]/page_client-reference-manifest.js",
        ),
      ).toBe(false);
      expect(
        routeHasOptionalRootLocale(
          path.join(fixtureRoot, "top-layout"),
          "[[...locale]]/page_client-reference-manifest.js",
        ),
      ).toBe(false);

      // Escaped underscore segment (`%5Fshop` emitted as `_shop`), ignoring any
      // sibling private `_shop` folder that Next.js excludes from routing.
      writeLayout("escaped-underscore", "app/_shop/layout.jsx");
      writeLayout("escaped-underscore", "app/%5Fshop/[[...locale]]/layout.tsx");
      expect(
        routeHasOptionalRootLocale(
          path.join(fixtureRoot, "escaped-underscore"),
          "_shop/[[...locale]]/page_client-reference-manifest.js",
        ),
      ).toBe(true);

      // A colocated directory named `layout.tsx/` is not a layout file and must
      // not mask the real root layout under `[[...locale]]`.
      mkdirSync(path.join(fixtureRoot, "colocated-dir/app/layout.tsx"), { recursive: true });
      writeLayout("colocated-dir", "app/[[...locale]]/layout.tsx");
      expect(
        routeHasOptionalRootLocale(
          path.join(fixtureRoot, "colocated-dir"),
          "[[...locale]]/page_client-reference-manifest.js",
        ),
      ).toBe(true);

      // src/app/(marketing)/[[...locale]]/layout.page.tsx with custom pageExtensions.
      writeLayout("src-custom-ext", "src/app/(marketing)/[[...locale]]/layout.page.tsx");
      expect(
        routeHasOptionalRootLocale(
          path.join(fixtureRoot, "src-custom-ext"),
          "(marketing)/[[...locale]]/page_client-reference-manifest.js",
          ["page.tsx", "tsx"],
        ),
      ).toBe(true);
      expect(
        routeHasOptionalRootLocale(
          path.join(fixtureRoot, "src-custom-ext"),
          "(marketing)/[[...locale]]/page_client-reference-manifest.js",
          ["tsx"],
        ),
      ).toBe(false);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
    // When `rootParams.locale` already decides in default route-first mode,
    // `unit.headers` is not even read.
    const spyHeaders = header("en");
    const getHeader = vi.spyOn(spyHeaders, "get");
    expect(
      resolveRenderLocale(
        locales,
        "en",
        undefined,
        unit({ rootParams: { locale: "de" }, headers: spyHeaders }),
      ),
    ).toBe("de");
    expect(getHeader).not.toHaveBeenCalled();
    expect(
      resolveRenderLocale(locales, "en", undefined, unit({ rootParams: { locale: "de" } })),
    ).toBe("de");
    expect(resolveRenderLocale(locales, "en", undefined, unit({ headers: header("de") }))).toBe(
      "de",
    );
  });

  it("embeds optional-root-locale route-tree detection into built manifests without relying on layout asset entries", async () => {
    const projectRoot = mkdtempSync(path.join(os.tmpdir(), "palamedes-built-optional-locale-"));
    try {
      // Minimal Palamedes project with two locales and a server-only root layout
      // at app/shop/[[...locale]]/layout.jsx (omitted from entryJSFiles/entryCSSFiles,
      // matching Next 16.4.6 Turbopack output for server-only layouts).
      mkdirSync(path.join(projectRoot, "app/shop/[[...locale]]"), { recursive: true });
      mkdirSync(path.join(projectRoot, "locales"), { recursive: true });
      writeFileSync(
        path.join(projectRoot, "palamedes.yaml"),
        "locales: [en, de]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}\n    include: [app]\n",
      );
      writeFileSync(path.join(projectRoot, "locales/en.po"), 'msgid "Hello"\nmsgstr "Hello"\n');
      writeFileSync(path.join(projectRoot, "locales/de.po"), 'msgid "Hello"\nmsgstr "Hallo"\n');
      writeFileSync(
        path.join(projectRoot, "app/shop/[[...locale]]/layout.jsx"),
        "export default function Layout({ children }) { return children; }\n",
      );

      const distDir = path.join(projectRoot, ".next");
      mkdirSync(path.join(distDir, "static/chunks"), { recursive: true });
      mkdirSync(path.join(distDir, "server/app/shop/[[...locale]]"), { recursive: true });
      const payload = Buffer.from(
        JSON.stringify({ source: "app/shop/[[...locale]]/page.jsx", ids: ["Hello"] }),
      ).toString("base64url");
      writeFileSync(
        path.join(distDir, "static/chunks/page.js"),
        `export const msgs = clientCatalogMessages("pmds-next:aaaaaaaaaaaa:${payload}");\n`,
      );
      writeFileSync(
        path.join(distDir, "build-manifest.json"),
        JSON.stringify({ rootMainFiles: [] }),
      );
      const manifestPath = path.join(
        distDir,
        "server/app/shop/[[...locale]]/page_client-reference-manifest.js",
      );
      // Matches Next 16.4.6 Turbopack: entryJSFiles/entryCSSFiles contain only the
      // client page and builtin fallbacks, with no layout key at all.
      writeFileSync(
        manifestPath,
        `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};
globalThis.__RSC_MANIFEST["/shop/[[...locale]]/page"] = ${JSON.stringify({
          entryCSSFiles: { "[project]/app/shop/[[...locale]]/page": [] },
          entryJSFiles: { "[project]/app/shop/[[...locale]]/page": ["static/chunks/page.js"] },
        })};`,
      );

      await emitClientCatalogPermutations({
        distDir,
        projectRoot,
        failOnMissing: false,
      });

      const manifestSource = readFileSync(manifestPath, "utf8");
      const context: Record<string, unknown> = { process: { env: {} } };
      vm.runInNewContext(manifestSource, context);
      const bind = context.__PALAMEDES_CLIENT_CATALOG_BIND as (
        fn: (locales: readonly string[], fallback: string, optionalRootLocale?: boolean) => string,
      ) => void;
      bind((availableLocales, fallbackLocale, optionalRootLocale) =>
        resolveRenderLocale(
          availableLocales,
          fallbackLocale,
          render("/shop/[[...locale]]"),
          unit({ rootParams: {}, headers: header("de") }),
          typeof optionalRootLocale === "boolean" ? { optionalRootLocale } : {},
        ),
      );
      const entryFiles = (
        context.__RSC_MANIFEST as Record<string, { entryJSFiles: Record<string, string[]> }>
      )["/shop/[[...locale]]/page"]!.entryJSFiles["[project]/app/shop/[[...locale]]/page"]!;
      // Because app/shop/[[...locale]]/layout.jsx is the root layout, an
      // omitted locale on /shop must fall back to "en" instead of trusting the header.
      expect(entryFiles[0]).toMatch(/^static\/chunks\/page\.en-[0-9a-f]{8}\.js$/u);

      // Adding a top-level app/layout.jsx moves the root layout above /shop/[[...locale]],
      // so the same route now accepts the Proxy header in route-first mode.
      writeFileSync(
        path.join(projectRoot, "app/layout.jsx"),
        "export default function RootLayout({ children }) { return children; }\n",
      );
      await emitClientCatalogPermutations({
        distDir,
        projectRoot,
        failOnMissing: false,
      });
      const nestedManifestSource = readFileSync(manifestPath, "utf8");
      const nestedContext: Record<string, unknown> = { process: { env: {} } };
      vm.runInNewContext(nestedManifestSource, nestedContext);
      const bindNested = nestedContext.__PALAMEDES_CLIENT_CATALOG_BIND as (
        fn: (locales: readonly string[], fallback: string, optionalRootLocale?: boolean) => string,
      ) => void;
      bindNested((availableLocales, fallbackLocale, optionalRootLocale) =>
        resolveRenderLocale(
          availableLocales,
          fallbackLocale,
          render("/shop/[[...locale]]"),
          unit({ rootParams: {}, headers: header("de") }),
          typeof optionalRootLocale === "boolean" ? { optionalRootLocale } : {},
        ),
      );
      const nestedEntryFiles = (
        nestedContext.__RSC_MANIFEST as Record<string, { entryJSFiles: Record<string, string[]> }>
      )["/shop/[[...locale]]/page"]!.entryJSFiles["[project]/app/shop/[[...locale]]/page"]!;
      expect(nestedEntryFiles[0]).toMatch(/^static\/chunks\/page\.de-[0-9a-f]{8}\.js$/u);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("embeds optional-root-locale detection for escaped %5F underscore route segments", async () => {
    const projectRoot = mkdtempSync(path.join(os.tmpdir(), "palamedes-built-escaped-locale-"));
    try {
      mkdirSync(path.join(projectRoot, "app/%5Fshop/[[...locale]]"), { recursive: true });
      mkdirSync(path.join(projectRoot, "locales"), { recursive: true });
      writeFileSync(
        path.join(projectRoot, "palamedes.yaml"),
        "locales: [en, de]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}\n    include: [app]\n",
      );
      writeFileSync(path.join(projectRoot, "locales/en.po"), 'msgid "Hello"\nmsgstr "Hello"\n');
      writeFileSync(path.join(projectRoot, "locales/de.po"), 'msgid "Hello"\nmsgstr "Hallo"\n');
      writeFileSync(
        path.join(projectRoot, "app/%5Fshop/[[...locale]]/layout.tsx"),
        "export default function Layout({ children }) { return children; }\n",
      );

      const distDir = path.join(projectRoot, ".next");
      mkdirSync(path.join(distDir, "static/chunks"), { recursive: true });
      mkdirSync(path.join(distDir, "server/app/_shop/[[...locale]]"), { recursive: true });
      const payload = Buffer.from(
        JSON.stringify({ source: "app/%5Fshop/[[...locale]]/page.tsx", ids: ["Hello"] }),
      ).toString("base64url");
      writeFileSync(
        path.join(distDir, "static/chunks/page.js"),
        `export const msgs = clientCatalogMessages("pmds-next:aaaaaaaaaaaa:${payload}");\n`,
      );
      writeFileSync(
        path.join(distDir, "build-manifest.json"),
        JSON.stringify({ rootMainFiles: [] }),
      );
      const manifestPath = path.join(
        distDir,
        "server/app/_shop/[[...locale]]/page_client-reference-manifest.js",
      );
      writeFileSync(
        manifestPath,
        `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};
globalThis.__RSC_MANIFEST["/_shop/[[...locale]]/page"] = ${JSON.stringify({
          entryCSSFiles: { "[project]/app/%5Fshop/[[...locale]]/page": [] },
          entryJSFiles: { "[project]/app/%5Fshop/[[...locale]]/page": ["static/chunks/page.js"] },
        })};`,
      );

      await emitClientCatalogPermutations({
        distDir,
        projectRoot,
        failOnMissing: false,
      });

      const manifestSource = readFileSync(manifestPath, "utf8");
      const context: Record<string, unknown> = { process: { env: {} } };
      vm.runInNewContext(manifestSource, context);
      const bind = context.__PALAMEDES_CLIENT_CATALOG_BIND as (
        fn: (locales: readonly string[], fallback: string, optionalRootLocale?: boolean) => string,
      ) => void;
      bind((availableLocales, fallbackLocale, optionalRootLocale) =>
        resolveRenderLocale(
          availableLocales,
          fallbackLocale,
          render("/_shop/[[...locale]]"),
          unit({ rootParams: {}, headers: header("de") }),
          typeof optionalRootLocale === "boolean" ? { optionalRootLocale } : {},
        ),
      );
      const entryFiles = (
        context.__RSC_MANIFEST as Record<string, { entryJSFiles: Record<string, string[]> }>
      )["/_shop/[[...locale]]/page"]!.entryJSFiles["[project]/app/%5Fshop/[[...locale]]/page"]!;
      expect(entryFiles[0]).toMatch(/^static\/chunks\/page\.en-[0-9a-f]{8}\.js$/u);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("derives the root-layout boundary from Next's compiled loaderTree even when wrapper-configured pageExtensions differ", async () => {
    const projectRoot = mkdtempSync(path.join(os.tmpdir(), "palamedes-compiled-loader-tree-"));
    try {
      // A wrapper applied after withPalamedes() added `page.tsx`, so the layout
      // file is `layout.page.tsx` while emitClientCatalogPermutations() receives
      // only the default pageExtensions. Reading Next's compiled loaderTree
      // still detects the exact root layout boundary.
      mkdirSync(path.join(projectRoot, "app/[[...locale]]"), { recursive: true });
      mkdirSync(path.join(projectRoot, "locales"), { recursive: true });
      writeFileSync(
        path.join(projectRoot, "palamedes.yaml"),
        "locales: [en, de]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}\n    include: [app]\n",
      );
      writeFileSync(path.join(projectRoot, "locales/en.po"), 'msgid "Hello"\nmsgstr "Hello"\n');
      writeFileSync(path.join(projectRoot, "locales/de.po"), 'msgid "Hello"\nmsgstr "Hallo"\n');
      writeFileSync(
        path.join(projectRoot, "app/[[...locale]]/layout.page.tsx"),
        "export default function Layout({ children }) { return children; }\n",
      );

      const distDir = path.join(projectRoot, ".next");
      mkdirSync(path.join(distDir, "static/chunks"), { recursive: true });
      mkdirSync(path.join(distDir, "server/app/[[...locale]]"), { recursive: true });
      mkdirSync(path.join(distDir, "server/chunks/ssr"), { recursive: true });
      const payload = Buffer.from(
        JSON.stringify({ source: "app/[[...locale]]/page.page.tsx", ids: ["Hello"] }),
      ).toString("base64url");
      writeFileSync(
        path.join(distDir, "static/chunks/page.js"),
        `export const msgs = clientCatalogMessages("pmds-next:aaaaaaaaaaaa:${payload}");\n`,
      );
      writeFileSync(
        path.join(distDir, "build-manifest.json"),
        JSON.stringify({ rootMainFiles: [] }),
      );
      const manifestPath = path.join(
        distDir,
        "server/app/[[...locale]]/page_client-reference-manifest.js",
      );
      writeFileSync(
        manifestPath,
        `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};
globalThis.__RSC_MANIFEST["/[[...locale]]/page"] = ${JSON.stringify({
          entryCSSFiles: {},
          entryJSFiles: { "[project]/app/[[...locale]]/page": ["static/chunks/page.js"] },
        })};`,
      );
      writeFileSync(
        path.join(distDir, "server/app/[[...locale]]/page.js"),
        `var R=require("../../chunks/ssr/[turbopack]_runtime.js")("server/app/[[...locale]]/page.js")\nR.c("server/chunks/ssr/next_dist_esm_build_templates_app-page_abc.js")\n`,
      );
      const templateChunk = path.join(
        distDir,
        "server/chunks/ssr/next_dist_esm_build_templates_app-page_abc.js",
      );
      writeFileSync(
        templateChunk,
        `module.exports=[1,a=>{let unrelated=["",{children:["other",{},{},[]]},{layout:[u,"other"]},[]];let j=["",{children:["[[...locale]]",{children:["__PAGE__",{},{metadata:{},page:[p,"[project]/app/[[...locale]]/page.page.tsx"]},[]]},{metadata:{},layout:[l,"[project]/app/[[...locale]]/layout.page.tsx"]},[]]},{"global-error":[g,"builtin"]},[]];let m=(0,c.f)({tree:j,page:"/[[...locale]]/page",pathname:"/[[...locale]]"});}];`,
      );

      expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath)).toBe(true);
      await emitClientCatalogPermutations({
        distDir,
        projectRoot,
        failOnMissing: false,
      });

      const context: Record<string, unknown> = { process: { env: {} } };
      vm.runInNewContext(readFileSync(manifestPath, "utf8"), context);
      const bind = context.__PALAMEDES_CLIENT_CATALOG_BIND as (
        fn: (locales: readonly string[], fallback: string, optionalRootLocale?: boolean) => string,
      ) => void;
      bind((availableLocales, fallbackLocale, optionalRootLocale) =>
        resolveRenderLocale(
          availableLocales,
          fallbackLocale,
          render("/[[...locale]]"),
          unit({ rootParams: {}, headers: header("de") }),
          typeof optionalRootLocale === "boolean" ? { optionalRootLocale } : {},
        ),
      );
      const entryFiles = (
        context.__RSC_MANIFEST as Record<string, { entryJSFiles: Record<string, string[]> }>
      )["/[[...locale]]/page"]!.entryJSFiles["[project]/app/[[...locale]]/page"]!;
      expect(entryFiles[0]).toMatch(/^static\/chunks\/page\.en-[0-9a-f]{8}\.js$/u);

      // When the compiled loaderTree has a root layout at "" above [[...locale]],
      // compiledRouteHasOptionalRootLocale returns false even if no default-named
      // layout file exists.
      writeFileSync(
        templateChunk,
        `module.exports=[1,a=>{let j=["",{children:["[[...locale]]",{children:["__PAGE__",{},{metadata:{},page:[p,"[project]/app/[[...locale]]/page.page.tsx"]},[]]},{metadata:{}},[]]},{layout:[l,"[project]/app/layout.page.tsx"],"global-error":[g,"builtin"]},[]];let m=(0,c.f)({tree:j,page:"/[[...locale]]/page",pathname:"/[[...locale]]"});}];`,
      );
      expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath)).toBe(false);

      // If no entrypoint binds `tree` for this page, return undefined so the
      // source-tree fallback runs instead of trusting an unrelated array.
      writeFileSync(
        templateChunk,
        `module.exports=[1,a=>{let unrelated=["",{children:["other",{},{},[]]},{layout:[u,"other"]},[]];}];`,
      );
      expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath)).toBeUndefined();
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("supports opting into header precedence or route-only resolution", () => {
    expect(
      resolveRenderLocale(
        locales,
        "en",
        undefined,
        unit({ rootParams: { locale: "de" }, headers: header("en") }),
        { localeSource: "header" },
      ),
    ).toBe("en");
    expect(
      resolveRenderLocale(locales, "en", undefined, unit({ rootParams: { locale: "de" } }), {
        localeSource: "header",
      }),
    ).toBe("de");
    expect(
      resolveRenderLocale(locales, "en", undefined, unit({ headers: header("de") }), {
        localeSource: "route",
      }),
    ).toBe("en");
    // Unknown or explicitly undefined localeSource policies fail loudly instead
    // of silently falling back to a mode that reads headers.
    expect(() =>
      bindClientCatalogPermutationsAt("/nonexistent", {
        localeSource: "route-only" as unknown as "route",
      }),
    ).toThrow(/unsupported localeSource/u);
    expect(() =>
      bindClientCatalogPermutationsAt("/nonexistent", {
        localeSource: undefined,
      }),
    ).toThrow(/unsupported localeSource/u);
    expect(() =>
      resolveRenderLocale(locales, "en", undefined, unit({ headers: header("de") }), {
        localeSource: "route-only" as unknown as "route",
      }),
    ).toThrow(/unsupported localeSource/u);
  });

  it("verifies HMAC-signed Proxy locale headers when headerSecret is configured", () => {
    const secret = "test-proxy-secret";
    const signedDe = signClientCatalogLocaleHeader("de", secret);
    const signedEn = signClientCatalogLocaleHeader("en", secret);

    expect(
      resolveRenderLocale(locales, "en", undefined, unit({ headers: header(signedDe) }), {
        headerSecret: secret,
      }),
    ).toBe("de");
    expect(
      resolveRenderLocale(
        locales,
        "en",
        undefined,
        unit({ rootParams: { locale: "de" }, headers: header(signedEn) }),
        { localeSource: "header", headerSecret: secret },
      ),
    ).toBe("en");
    // Unsigned, tampered, or wrong-secret headers are ignored.
    expect(
      resolveRenderLocale(locales, "en", undefined, unit({ headers: header("de") }), {
        headerSecret: secret,
      }),
    ).toBe("en");
    expect(
      resolveRenderLocale(locales, "en", undefined, unit({ headers: header("de.tampered") }), {
        headerSecret: secret,
      }),
    ).toBe("en");
    expect(
      resolveRenderLocale(
        locales,
        "en",
        undefined,
        unit({ headers: header(signClientCatalogLocaleHeader("de", "other-secret")) }),
        { headerSecret: secret },
      ),
    ).toBe("en");
    expect(
      resolveRenderLocale(
        locales,
        "en",
        undefined,
        unit({ rootParams: { locale: "de" }, headers: header("en") }),
        { localeSource: "header", headerSecret: secret },
      ),
    ).toBe("de");
    expect(() => signClientCatalogLocaleHeader("de", "")).toThrow(/non-empty secret/u);
    expect(() => bindClientCatalogPermutationsAt("/nonexistent", { headerSecret: "" })).toThrow(
      /non-empty string/u,
    );
    expect(() =>
      bindClientCatalogPermutationsAt("/nonexistent", { headerSecret: undefined }),
    ).toThrow(/non-empty string/u);
    expect(
      resolveRenderLocale(locales, "en", undefined, unit({ headers: header("de") }), {
        headerSecret: "",
      }),
    ).toBe("en");
    expect(
      resolveRenderLocale(locales, "en", undefined, unit({ headers: header("de") }), {
        headerSecret: undefined,
      }),
    ).toBe("en");
    // Inherited option getters are honored rather than silently treated as unsigned mode.
    class InheritedSecretOptions {
      private readonly value: string | undefined;
      public constructor(value: string | undefined) {
        this.value = value;
      }
      public get headerSecret(): string | undefined {
        return this.value;
      }
    }
    expect(
      resolveRenderLocale(
        locales,
        "en",
        undefined,
        unit({ headers: header(signedDe) }),
        new InheritedSecretOptions(secret),
      ),
    ).toBe("de");
    expect(
      resolveRenderLocale(
        locales,
        "en",
        undefined,
        unit({ headers: header("de") }),
        new InheritedSecretOptions(secret),
      ),
    ).toBe("en");
    expect(() =>
      bindClientCatalogPermutationsAt("/nonexistent", new InheritedSecretOptions(undefined)),
    ).toThrow(/non-empty string/u);
  });

  it("does not guess from other params and falls back for unknown or missing locales", () => {
    expect(
      resolveRenderLocale(locales, "en", undefined, unit({ rootParams: { slug: "de" } })),
    ).toBe("en");
    expect(
      resolveRenderLocale(locales, "en", undefined, unit({ rootParams: { locale: "zz" } })),
    ).toBe("en");
    expect(resolveRenderLocale(locales, "en", undefined, unit({ headers: header("fr") }))).toBe(
      "en",
    );
    expect(resolveRenderLocale(locales, "de", undefined, undefined)).toBe("de");
  });

  it("memoizes per render, so later serialization without a unit store keeps the locale", () => {
    const work = render("/[locale]/page");
    expect(resolveRenderLocale(locales, "en", work, unit({ rootParams: { locale: "de" } }))).toBe(
      "de",
    );
    expect(resolveRenderLocale(locales, "en", work, undefined)).toBe("de");
    expect(resolveRenderLocale(locales, "en", work, unit({ headers: header("en") }))).toBe("de");
  });
});
