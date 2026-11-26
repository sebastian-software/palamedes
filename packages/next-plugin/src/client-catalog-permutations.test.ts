import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

import { describe, expect, it, vi } from "vitest";

import {
  bindClientCatalogPermutationsAt,
  resolveRenderLocale,
  signClientCatalogLocaleHeader,
  verifyClientCatalogLocaleHeader,
} from "./client-catalog-binding";
import {
  type ChunkGraph,
  affectedChunks,
  assertNoBootstrapChunks,
  assertChunkCoverage,
  chunkReferences,
  compiledLoaderTreeHasOptionalRootLocale,
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
      const writeRouteFile = (project: string, relativePath: string) => {
        const target = path.join(fixtureRoot, project, relativePath);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(
          target,
          "export default function Component({ children }: { children?: unknown }) { return children ?? null; }\n",
        );
      };

      // Server-only root layout at app/shop/[[...locale]]/layout.jsx (no app/layout.jsx).
      writeRouteFile("nested-root", "app/shop/[[...locale]]/layout.jsx");
      writeRouteFile("nested-root", "app/shop/[[...locale]]/page.jsx");
      expect(
        routeHasOptionalRootLocale(
          path.join(fixtureRoot, "nested-root"),
          "shop/[[...locale]]/page_client-reference-manifest.js",
        ),
      ).toBe(true);

      // Root layout at app/layout.jsx above app/shop/[[...locale]]/page.jsx.
      writeRouteFile("top-layout", "app/layout.jsx");
      writeRouteFile("top-layout", "app/shop/[[...locale]]/layout.jsx");
      writeRouteFile("top-layout", "app/shop/[[...locale]]/page.jsx");
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
      writeRouteFile("escaped-underscore", "app/_shop/layout.jsx");
      writeRouteFile("escaped-underscore", "app/%5Fshop/[[...locale]]/layout.tsx");
      writeRouteFile("escaped-underscore", "app/%5Fshop/[[...locale]]/page.tsx");
      expect(
        routeHasOptionalRootLocale(
          path.join(fixtureRoot, "escaped-underscore"),
          "_shop/[[...locale]]/page_client-reference-manifest.js",
        ),
      ).toBe(true);

      // A colocated directory named `layout.tsx/` is not a layout file and must
      // not mask the real root layout under `[[...locale]]`.
      mkdirSync(path.join(fixtureRoot, "colocated-dir/app/layout.tsx"), { recursive: true });
      writeRouteFile("colocated-dir", "app/[[...locale]]/layout.tsx");
      writeRouteFile("colocated-dir", "app/[[...locale]]/page.tsx");
      expect(
        routeHasOptionalRootLocale(
          path.join(fixtureRoot, "colocated-dir"),
          "[[...locale]]/page_client-reference-manifest.js",
        ),
      ).toBe(true);

      // Verbatim pageExtensions: Next.js does not strip a leading dot from
      // `.mdx`, so `app/layout.mdx` must not be treated as a layout when
      // `pageExtensions` is `["tsx", ".mdx"]`.
      writeRouteFile("verbatim-ext", "app/layout.mdx");
      writeRouteFile("verbatim-ext", "app/[[...locale]]/layout.tsx");
      writeRouteFile("verbatim-ext", "app/[[...locale]]/page.tsx");
      expect(
        routeHasOptionalRootLocale(
          path.join(fixtureRoot, "verbatim-ext"),
          "[[...locale]]/page_client-reference-manifest.js",
          ["tsx", ".mdx"],
        ),
      ).toBe(true);
      writeRouteFile("src-custom-ext", "src/app/(marketing)/[[...locale]]/layout.page.tsx");
      writeRouteFile("src-custom-ext", "src/app/(marketing)/[[...locale]]/page.page.tsx");
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
      ).toBeUndefined();
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

  it("follows layout file symlinks (and ignores symlinked directories) in the source-tree fallback", (context) => {
    const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "palamedes-symlink-layout-tree-"));
    try {
      const writeLayout = (project: string, relativePath: string) => {
        const target = path.join(fixtureRoot, project, relativePath);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(
          target,
          "export default function Layout({ children }) { return children; }\n",
        );
      };

      writeLayout("symlink-file", "shared/root-layout.tsx");
      writeLayout("symlink-file", "app/[[...locale]]/layout.tsx");
      try {
        symlinkSync(
          path.join(fixtureRoot, "symlink-file/shared/root-layout.tsx"),
          path.join(fixtureRoot, "symlink-file/app/layout.tsx"),
        );
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EPERM" || code === "EACCES") {
          context.skip();
          return;
        }
        throw error;
      }
      expect(
        routeHasOptionalRootLocale(
          path.join(fixtureRoot, "symlink-file"),
          "[[...locale]]/page_client-reference-manifest.js",
        ),
      ).toBe(false);

      mkdirSync(path.join(fixtureRoot, "symlink-dir/shared/dir"), { recursive: true });
      writeLayout("symlink-dir", "app/[[...locale]]/layout.tsx");
      writeLayout("symlink-dir", "app/[[...locale]]/page.tsx");
      symlinkSync(
        path.join(fixtureRoot, "symlink-dir/shared/dir"),
        path.join(fixtureRoot, "symlink-dir/app/layout.tsx"),
      );
      expect(
        routeHasOptionalRootLocale(
          path.join(fixtureRoot, "symlink-dir"),
          "[[...locale]]/page_client-reference-manifest.js",
        ),
      ).toBe(true);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
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
      const ep = (
        treeField: string,
        page = '"/[[...locale]]/page"',
        pathname = '"/[[...locale]]"',
      ) =>
        `(0,c.f)({${treeField},page:${page},pathname:${pathname},require:r,loadChunk:lc,interopDefault:id})`;
      writeFileSync(
        templateChunk,
        `module.exports=[1,a=>{let unrelated=["",{children:["other",{},{},[]]},{layout:[u,"other"]},[]];let j=["",{children:["[[...locale]]",{children:["__PAGE__",{},{metadata:{},page:[p,"[project]/app/[[...locale]]/page.page.tsx"]},[]]},{metadata:{},layout:[l,"[project]/app/[[...locale]]/layout.page.tsx"]},[]]},{"global-error":[g,"builtin"]},[]];let m=${ep("tree:j")};}];`,
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
        `module.exports=[1,a=>{let j=["",{children:["[[...locale]]",{children:["__PAGE__",{},{metadata:{},page:[p,"[project]/app/[[...locale]]/page.page.tsx"]},[]]},{metadata:{}},[]]},{layout:[l,"[project]/app/layout.page.tsx"],"global-error":[g,"builtin"]},[]];let m=${ep("tree:j")};}];`,
      );
      expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath)).toBe(false);

      // Unminified Turbopack output (`experimental.turbopackMinify: false`) uses
      // shorthand properties such as `{ tree, page: "...", interopDefault }`.
      writeFileSync(
        templateChunk,
        `const tree = ["", {
  "children": ["[[...locale]]", {
    "children": ["__PAGE__", {}, {
      metadata: {},
      "page": [p, "[project]/app/[[...locale]]/page.page.tsx"],
    }, []],
  }, {
    metadata: {},
    "layout": [l, "[project]/app/[[...locale]]/layout.page.tsx"],
  }, []],
}, {
  "global-error": [g, "builtin"],
}, []]
const entrypoint = createAppPageEntrypoint({
  tree,
  page: "/[[...locale]]/page",
  pathname: "/[[...locale]]",
  require: __next_app_require__,
  loadChunk: __next_app_load_chunk__,
  interopDefault
});`,
      );
      expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath)).toBe(true);

      // Single-quoted JS string with escaped apostrophe in a Windows-portable
      // directory name (`Bob's recs`), plus an in-memory check for routes
      // containing both `'` and `"` (`Bob's "recs"`, which POSIX supports and
      // Windows disallows in directory names).
      const specialDir = path.join(projectRoot, "app/Bob's recs/[[...locale]]");
      mkdirSync(specialDir, { recursive: true });
      writeFileSync(
        path.join(specialDir, "layout.page.jsx"),
        "export default function Layout({ children }) { return children; }\n",
      );
      const specialManifestDir = path.join(distDir, "server/app/Bob's recs/[[...locale]]");
      mkdirSync(specialManifestDir, { recursive: true });
      const specialManifestPath = path.join(
        specialManifestDir,
        "page_client-reference-manifest.js",
      );
      writeFileSync(
        specialManifestPath,
        `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};
globalThis.__RSC_MANIFEST[${JSON.stringify("/Bob's recs/[[...locale]]/page")}] = ${JSON.stringify({
          entryCSSFiles: {},
          entryJSFiles: {
            "[project]/app/Bob's recs/[[...locale]]/page": ["static/chunks/page.js"],
          },
        })};`,
      );
      writeFileSync(
        path.join(specialManifestDir, "page.js"),
        `var R=require("../../../chunks/ssr/[turbopack]_runtime.js")("server/app/Bob's recs/[[...locale]]/page.js")\nR.c("server/chunks/ssr/next_dist_esm_build_templates_app-page_special.js")\n`,
      );
      writeFileSync(
        path.join(distDir, "server/chunks/ssr/next_dist_esm_build_templates_app-page_special.js"),
        `module.exports=[2,a=>{let j=["",{children:['Bob\\'s recs',{children:["[[...locale]]",{children:["__PAGE__",{},{metadata:{},page:[p,'[project]/app/Bob\\'s recs/[[...locale]]/page.page.jsx']},[]]},{metadata:{},layout:[l,'[project]/app/Bob\\'s recs/[[...locale]]/layout.page.jsx']},[]]},{metadata:{}},[]]},{"global-error":[g,"builtin"]},[]];let m=${ep("tree:j", "'/Bob\\'s recs/[[...locale]]/page'", "'/Bob\\'s recs/[[...locale]]'")};}];`,
      );
      expect(compiledRouteHasOptionalRootLocale(distDir, specialManifestPath)).toBe(true);
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `module.exports=[2,a=>{let j=["",{children:['Bob\\'s "recs"',{children:["[[...locale]]",{children:["__PAGE__",{},{metadata:{},page:[p,'[project]/app/Bob\\'s "recs"/[[...locale]]/page.page.jsx']},[]]},{metadata:{},layout:[l,'[project]/app/Bob\\'s "recs"/[[...locale]]/layout.page.jsx']},[]]},{metadata:{}},[]]},{"global-error":[g,"builtin"]},[]];let m=${ep("tree:j", "'/Bob\\'s \"recs\"/[[...locale]]/page'", "'/Bob\\'s \"recs\"/[[...locale]]'")};}];`,
          '/Bob\'s "recs"/[[...locale]]/page',
        ),
      ).toBe(true);

      // Diagnostic or unrelated calls that only carry `tree` and `page` (without
      // Next's createAppPageEntrypoint properties) are ignored so they cannot
      // impersonate the page entrypoint when the real entrypoint receives a variable.
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `logDiagnostic({ tree: ["", {}, { layout: [l, "root"] }], page: "/[[...locale]]/page" }); const entrypoint = createAppPageEntrypoint(optionsObj);`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();

      // Nonliteral `children` references (e.g. a variable or shorthand) are
      // inconclusive and return undefined so emitClientCatalogPermutations()
      // falls back to inspecting the source tree instead of assuming false.
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `const child = ["[[...locale]]", {}, { layout: [l, "layout.tsx"] }]; const tree = ["", { children: child }, {}]; ${ep("tree")};`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `const children = ["[[...locale]]", {}, { layout: [l, "layout.tsx"] }]; const tree = ["", { children }, {}]; ${ep("tree")};`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      // A compiled tree whose `children` chain ends without a layout (even
      // after passing `[[...locale]]`) has no confirmed layout boundary and
      // returns undefined so the source-tree / fail-closed fallback runs.
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `const tree = ["", { children: ["[[...locale]]", { children: ["__PAGE__", {}, { page: [p, "page.tsx"] }, []] }, {}, []] }, {}, []]; ${ep("tree")};`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();

      // Explicit absent layout (`void 0` / `undefined`) on a parent continues down
      // `children` to the real layout under `[[...locale]]`, whereas a dynamic or
      // non-tuple layout expression returns undefined (inconclusive).
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `const tree = ["", { children: ["[[...locale]]", {}, { layout: [l, "layout.tsx"] }] }, { layout: void 0 }]; ${ep("tree")};`,
          "/[[...locale]]/page",
        ),
      ).toBe(true);
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `const tree = ["", { children: ["[[...locale]]", {}, { layout: [l, "layout.tsx"] }] }, { layout: maybeLayout }]; ${ep("tree")};`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      // `layout: null` satisfies `typeof layout !== "undefined"` in Next's
      // `getRootParamsImpl()`, so it must NOT descend past the parent layout;
      // treat it as inconclusive so the source-tree fallback runs.
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `const tree = ["", { children: ["[[...locale]]", {}, { layout: [l, "layout.tsx"] }] }, { layout: null }]; ${ep("tree")};`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();

      // Lexical scoping: block-scoped `let`/`const` bindings inside sibling
      // functions or earlier modules do not override the outer scope's tree,
      // while mutations, `var` redeclarations, or parameter shadowing return
      // undefined so the caller falls back to the source tree.
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `let t=["[[...locale]]",{},{layout:[l,"root"]}]; function other(){let t=["",{},{layout:[o,"otherRoot"]}]; return t} ${ep("tree:t")};`,
          "/[[...locale]]/page",
        ),
      ).toBe(true);
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `module.exports=[1,a=>{let j=["",{},{layout:[l,"a"]}]; ${ep("tree:j", '"/other/page"', '"/other"')};},2,a=>{let x=1,j=["",{children:["[[...locale]]",{},{layout:[l,"b"]}]},{}]; ${ep("tree:j")};}];`,
          "/[[...locale]]/page",
        ),
      ).toBe(true);
      // Deferred entrypoint calls inside a nested function/block capturing an
      // outer tree (which code after the function can mutate before calling it)
      // and destructured property aliases (`const { t: label } = meta`) followed
      // by outer mutation are treated as inconclusive.
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `let t=["",{children:["[[...locale]]",{},{layout:[i,"inner"]}]},{layout:[l,"root"]}]; function run(){ return ${ep("tree:t")}; } t[2]={}; run();`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `let t=["",{children:["[[...locale]]",{},{layout:[i,"inner"]}]},{layout:[l,"root"]}]; { const { t: label } = meta; t[2]={}; } ${ep("tree:t")};`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      // A destructured parameter alias (`function helper({ t: label })`) does
      // not shadow outer `t`, so writes to `t` inside `helper` taint outer `t`.
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `let t=["",{children:["[[...locale]]",{},{layout:[i,"inner"]}]},{layout:[l,"root"]}]; function helper({ t: label }){ t[2]={}; return label; } helper(meta); ${ep("tree:t")};`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      // In-place mutations (member writes, method calls, aliasing) or inline
      // chained array expressions (`tree: [...].with(...)`, `children: [...].with(...)`)
      // invalidate the static tree inference and return undefined.
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `let t=["",{children:["[[...locale]]",{},{layout:[i,"inner"]}]},{layout:[l,"root"]}]; t[2]={}; ${ep("tree:t")};`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `let t=["",{children:["[[...locale]]",{},{layout:[i,"inner"]}]},{layout:[l,"root"]}]; mutate(t); ${ep("tree:t")};`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      // Spreading `...t` aliases its inner modules object and must be treated
      // as an intervening reference rather than a property access `.t`.
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `let t=["",{children:["[[...locale]]",{},{layout:[i,"inner"]}]},{layout:[l,"root"]}]; const parts=[...t]; delete parts[2].layout; ${ep("tree:t")};`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      // Hoisted functions declared AFTER the entrypoint call in the same scope
      // may already have mutated `t` before the entrypoint runs.
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `const t=["",{children:["[[...locale]]",{},{layout:[i,"inner"]}]},{layout:[l,"root"]}]; finalizeTree(); ${ep("tree:t")}; function finalizeTree(){ delete t[2].layout; }`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      // Sibling entrypoint argument properties that reference or spread `t`
      // (for example `require: makeRequire(t)` or `makeRequire(...t)`) can
      // mutate the tree before the callee runs.
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `const t=["",{children:["[[...locale]]",{},{layout:[i,"inner"]}]},{layout:[l,"root"]}]; createAppPageEntrypoint({tree:t,page:"/[[...locale]]/page",pathname:"/[[...locale]]",require:makeRequire(t),loadChunk:lc,interopDefault:id});`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `const t=["",{children:["[[...locale]]",{},{layout:[i,"inner"]}]},{layout:[l,"root"]}]; createAppPageEntrypoint({tree:t,page:"/[[...locale]]/page",pathname:"/[[...locale]]",require:makeRequire(...t),loadChunk:lc,interopDefault:id});`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `let t=["",{children:["[[...locale]]",{},{layout:[i,"inner"]}]},{layout:[l,"root"]}]; const note = \`\${(t[2] = {}, "")}\`; ${ep("tree:t")};`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `${ep('tree:["",{children:["[[...locale]]",{},{layout:[i,"inner"]}]},{layout:[l,"root"]}].with(2,{})')};`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `${ep('tree:["",{children:["[[...locale]]",{},{layout:[i,"inner"]}].with(2,{})},{}]')};`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `let t=["[[...locale]]",{},{layout:[l,"root"]}]; function mutate(){t=["",{},{layout:[o,"otherRoot"]}];} ${ep("tree:t")};`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `let t=["[[...locale]]",{},{layout:[l,"root"]}]; if (cond) { var t=["",{},{layout:[o,"otherRoot"]}]; } ${ep("tree:t")};`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `let t=["",{},{layout:[o,"otherRoot"]}]; function run(t){ ${ep("tree:t")}; }`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      // Conditional, chained, or subsequent assignments in the same scope are inconclusive.
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `let t=["[[...locale]]",{},{layout:[l,"root"]}]; if (flag) t=["",{},{layout:[o,"otherRoot"]}]; ${ep("tree:t")};`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `const tree = ["", { children: ["[[...locale]]", {}, { layout: [l, "inner"] }] }, {}].with(2, { layout: [r, "root"] }); ${ep("tree")};`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `if (flag) var t=["",{},{layout:[o,"otherRoot"]}]; ${ep("tree:t")};`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      // Serialized route data inside string literals, template literals, or
      // comments must never be treated as a real entrypoint call.
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `const serialized = '${ep('tree:["",{},{layout:[l,"root"]}]')}';`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `const serialized = \`${ep('tree:["",{},{layout:[l,"root"]}]')}\`;`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `// ${ep('tree:["",{},{layout:[l,"root"]}]')}`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      // An ordinary file OR an empty colocated directory named `app/shop_front`
      // must not shadow `app/shop%5Ffront/[[...locale]]/layout.tsx` in the
      // filesystem fallback.
      const escapedProject = mkdtempSync(path.join(os.tmpdir(), "palamedes-escaped-file-shadow-"));
      try {
        mkdirSync(path.join(escapedProject, "app/shop%5Ffront/[[...locale]]"), { recursive: true });
        writeFileSync(path.join(escapedProject, "app/shop_front"), "not a directory\n");
        writeFileSync(
          path.join(escapedProject, "app/shop%5Ffront/[[...locale]]/layout.tsx"),
          "export default function Layout({ children }) { return children; }\n",
        );
        writeFileSync(
          path.join(escapedProject, "app/shop%5Ffront/[[...locale]]/page.tsx"),
          "export default function Page() { return null; }\n",
        );
        expect(
          routeHasOptionalRootLocale(
            escapedProject,
            "shop_front/[[...locale]]/page_client-reference-manifest.js",
          ),
        ).toBe(true);
        rmSync(path.join(escapedProject, "app/shop_front"));
        mkdirSync(path.join(escapedProject, "app/shop_front"), { recursive: true });
        expect(
          routeHasOptionalRootLocale(
            escapedProject,
            "shop_front/[[...locale]]/page_client-reference-manifest.js",
          ),
        ).toBe(true);
        // Even if `app/shop_front/[[...locale]]` also exists without a page entry,
        // matching the leaf `page.tsx` selects `app/shop%5Ffront/[[...locale]]`.
        mkdirSync(path.join(escapedProject, "app/shop_front/[[...locale]]"), { recursive: true });
        writeFileSync(
          path.join(escapedProject, "app/shop_front/layout.tsx"),
          "export default function ShadowLayout({ children }) { return children; }\n",
        );
        expect(
          routeHasOptionalRootLocale(
            escapedProject,
            "shop_front/[[...locale]]/page_client-reference-manifest.js",
          ),
        ).toBe(true);
        // If `app/shop%5Ffront/[[...locale]]/page.tsx` is removed so NO candidate
        // directory contains `page.tsx`, a colocated `app/shop_front/layout.tsx`
        // must NOT produce `false` — return undefined so the caller fails closed.
        rmSync(path.join(escapedProject, "app/shop%5Ffront/[[...locale]]/page.tsx"));
        expect(
          routeHasOptionalRootLocale(
            escapedProject,
            "shop_front/[[...locale]]/page_client-reference-manifest.js",
          ),
        ).toBeUndefined();
        // When a route's source directory chain cannot be located on disk,
        // routeHasOptionalRootLocale() returns undefined (unknown boundary)
        // rather than false so emitClientCatalogPermutations() fails closed.
        expect(
          routeHasOptionalRootLocale(
            escapedProject,
            "generated/[[...locale]]/page_client-reference-manifest.js",
          ),
        ).toBeUndefined();
        // Lowercase `%5f` is NOT decoded by Next.js, so `app/shop%5ffront` must
        // not participate when resolving `shop_front`.
        const caseProject = mkdtempSync(path.join(os.tmpdir(), "palamedes-case-escape-"));
        try {
          mkdirSync(path.join(caseProject, "app/shop_front/[[...locale]]"), { recursive: true });
          mkdirSync(path.join(caseProject, "app/shop%5ffront/[[...locale]]"), { recursive: true });
          writeFileSync(
            path.join(caseProject, "app/shop_front/layout.tsx"),
            "export default function RootLayout({ children }) { return children; }\n",
          );
          writeFileSync(
            path.join(caseProject, "app/shop_front/[[...locale]]/page.tsx"),
            "export default function Page() { return null; }\n",
          );
          writeFileSync(
            path.join(caseProject, "app/shop%5ffront/[[...locale]]/layout.tsx"),
            "export default function OtherLayout({ children }) { return children; }\n",
          );
          writeFileSync(
            path.join(caseProject, "app/shop%5ffront/[[...locale]]/page.tsx"),
            "export default function OtherPage() { return null; }\n",
          );
          expect(
            routeHasOptionalRootLocale(
              caseProject,
              "shop_front/[[...locale]]/page_client-reference-manifest.js",
            ),
          ).toBe(false);
        } finally {
          rmSync(caseProject, { recursive: true, force: true });
        }
      } finally {
        rmSync(escapedProject, { recursive: true, force: true });
      }
      // End-to-end fail-closed check: when compiled-tree inspection is
      // inconclusive AND the optional route's source directory is missing,
      // emitClientCatalogPermutations() still sets optionalRootLocale=true so
      // an omitted segment ignores x-palamedes-locale.
      const missingSourceRoot = mkdtempSync(path.join(os.tmpdir(), "palamedes-missing-src-root-"));
      try {
        mkdirSync(path.join(missingSourceRoot, "locales"), { recursive: true });
        writeFileSync(
          path.join(missingSourceRoot, "palamedes.yaml"),
          "locales: [en, de]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}\n    include: [app]\n",
        );
        writeFileSync(
          path.join(missingSourceRoot, "locales/en.po"),
          'msgid "Hello"\nmsgstr "Hello"\n',
        );
        writeFileSync(
          path.join(missingSourceRoot, "locales/de.po"),
          'msgid "Hello"\nmsgstr "Hallo"\n',
        );
        const missingDist = path.join(missingSourceRoot, ".next");
        mkdirSync(path.join(missingDist, "static/chunks"), { recursive: true });
        mkdirSync(path.join(missingDist, "server/app/generated/[[...locale]]"), {
          recursive: true,
        });
        writeFileSync(
          path.join(missingDist, "static/chunks/page.js"),
          `export const msgs = clientCatalogMessages("pmds-next:aaaaaaaaaaaa:${payload}");\n`,
        );
        writeFileSync(
          path.join(missingDist, "build-manifest.json"),
          JSON.stringify({ rootMainFiles: [] }),
        );
        const missingManifest = path.join(
          missingDist,
          "server/app/generated/[[...locale]]/page_client-reference-manifest.js",
        );
        writeFileSync(
          missingManifest,
          `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};
globalThis.__RSC_MANIFEST["/generated/[[...locale]]/page"] = ${JSON.stringify({
            entryCSSFiles: {},
            entryJSFiles: {
              "[project]/app/generated/[[...locale]]/page": ["static/chunks/page.js"],
            },
          })};`,
        );
        await emitClientCatalogPermutations({
          distDir: missingDist,
          projectRoot: missingSourceRoot,
          failOnMissing: false,
        });
        const ctx: Record<string, unknown> = { process: { env: {} } };
        vm.runInNewContext(readFileSync(missingManifest, "utf8"), ctx);
        const bindFn = ctx.__PALAMEDES_CLIENT_CATALOG_BIND as (
          fn: (
            locales: readonly string[],
            fallback: string,
            optionalRootLocale?: boolean,
          ) => string,
        ) => void;
        bindFn((availableLocales, fallbackLocale, optionalRootLocale) =>
          resolveRenderLocale(
            availableLocales,
            fallbackLocale,
            render("/generated/[[...locale]]"),
            unit({ rootParams: {}, headers: header("de") }),
            typeof optionalRootLocale === "boolean" ? { optionalRootLocale } : {},
          ),
        );
        const entry = (
          ctx.__RSC_MANIFEST as Record<string, { entryJSFiles: Record<string, string[]> }>
        )["/generated/[[...locale]]/page"]!.entryJSFiles[
          "[project]/app/generated/[[...locale]]/page"
        ]![0]!;
        expect(entry).toMatch(/^static\/chunks\/page\.en-[0-9a-f]{8}\.js$/u);
      } finally {
        rmSync(missingSourceRoot, { recursive: true, force: true });
      }
      // When the Next app-page template chunk is inconclusive, unrelated user
      // chunks — even ones whose filename contains `app-page` — must not supply
      // a false positive/negative.
      writeFileSync(
        path.join(distDir, "server/chunks/ssr/my_app-page_helper.js"),
        `const example = start({ tree: ["", {}, { layout: [l, "root"] }], page: "/[[...locale]]/page" });`,
      );
      writeFileSync(
        path.join(distDir, "server/app/[[...locale]]/page.js"),
        `var R=require("../../chunks/ssr/[turbopack]_runtime.js")("server/app/[[...locale]]/page.js")\nR.c("server/chunks/ssr/next_dist_esm_build_templates_app-page_abc.js")\nR.c("server/chunks/ssr/my_app-page_helper.js")\n`,
      );

      // End-to-end check: when the compiled loaderTree has a nonliteral child AND
      // a later config wrapper added `page.tsx` (so only `layout.page.tsx` exists,
      // with no default-named `layout.tsx`), emitClientCatalogPermutations() reads
      // Next's effective pageExtensions (from NextBuildContext during `next build`
      // or required-server-files.json post-build) and still marks optionalRootLocale=true.
      writeFileSync(
        templateChunk,
        `module.exports=[1,a=>{let child=["[[...locale]]",{},{layout:[l,"[project]/app/[[...locale]]/layout.page.tsx"]},[]];let j=["",{children:child},{"global-error":[g,"builtin"]},[]];let m=(0,c.f)({tree:j,page:"/[[...locale]]/page",pathname:"/[[...locale]]"});}];`,
      );
      expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath)).toBeUndefined();

      const resetManifest = () => {
        writeFileSync(
          manifestPath,
          `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};
globalThis.__RSC_MANIFEST["/[[...locale]]/page"] = ${JSON.stringify({
            entryCSSFiles: {},
            entryJSFiles: { "[project]/app/[[...locale]]/page": ["static/chunks/page.js"] },
          })};`,
        );
      };
      const evalRenderedEntry = () => {
        const ctx: Record<string, unknown> = { process: { env: {} } };
        vm.runInNewContext(readFileSync(manifestPath, "utf8"), ctx);
        const bindFn = ctx.__PALAMEDES_CLIENT_CATALOG_BIND as (
          fn: (
            locales: readonly string[],
            fallback: string,
            optionalRootLocale?: boolean,
          ) => string,
        ) => void;
        bindFn((availableLocales, fallbackLocale, optionalRootLocale) =>
          resolveRenderLocale(
            availableLocales,
            fallbackLocale,
            render("/[[...locale]]"),
            unit({ rootParams: {}, headers: header("de") }),
            typeof optionalRootLocale === "boolean" ? { optionalRootLocale } : {},
          ),
        );
        return (ctx.__RSC_MANIFEST as Record<string, { entryJSFiles: Record<string, string[]> }>)[
          "/[[...locale]]/page"
        ]!.entryJSFiles["[project]/app/[[...locale]]/page"]![0]!;
      };

      const nextRequire = createRequire(import.meta.url);
      const { NextBuildContext } = nextRequire("next/dist/build/build-context") as {
        NextBuildContext: {
          dir?: string;
          distDir?: string;
          config?: { pageExtensions?: string[] };
        };
      };
      const prevDir = NextBuildContext.dir;
      const prevDistDir = NextBuildContext.distDir;
      const prevConfig = NextBuildContext.config;
      try {
        NextBuildContext.dir = projectRoot;
        NextBuildContext.distDir = distDir;
        NextBuildContext.config = { pageExtensions: ["page.tsx", "page.jsx"] };
        resetManifest();
        await emitClientCatalogPermutations({
          distDir,
          projectRoot,
          // Even if an earlier config captured stale pageExtensions, Next's
          // final effective pageExtensions win.
          pageExtensions: ["tsx", "jsx"],
          failOnMissing: false,
        });
        expect(evalRenderedEntry()).toMatch(/^static\/chunks\/page\.en-[0-9a-f]{8}\.js$/u);

        // Placing a top-level `app/layout.page.tsx` above `[[...locale]]` proves
        // Next's effective pageExtensions actually govern the fallback:
        // - With matching NextBuildContext.distDir (`page.tsx`), `app/layout.page.tsx`
        //   is recognized as a root layout above `[[...locale]]` -> header allowed (`de`).
        // - With an unrelated NextBuildContext.distDir, `app/layout.page.tsx` is not
        //   recognized, the layout boundary is unknown, and the fallback fails closed (`en`).
        const topCustomLayout = path.join(projectRoot, "app/layout.page.tsx");
        writeFileSync(
          topCustomLayout,
          "export default function TopLayout({ children }) { return children; }\n",
        );
        try {
          resetManifest();
          await emitClientCatalogPermutations({
            distDir,
            projectRoot,
            pageExtensions: ["tsx", "jsx"],
            failOnMissing: false,
          });
          expect(evalRenderedEntry()).toMatch(/^static\/chunks\/page\.de-[0-9a-f]{8}\.js$/u);

          NextBuildContext.distDir = path.join(projectRoot, ".other-next");
          resetManifest();
          await emitClientCatalogPermutations({
            distDir,
            projectRoot,
            failOnMissing: false,
          });
          expect(evalRenderedEntry()).toMatch(/^static\/chunks\/page\.en-[0-9a-f]{8}\.js$/u);
        } finally {
          rmSync(topCustomLayout, { force: true });
        }
      } finally {
        NextBuildContext.dir = prevDir;
        NextBuildContext.distDir = prevDistDir;
        NextBuildContext.config = prevConfig;
      }

      // Post-build fallback: when NextBuildContext is absent, required-server-files.json
      // provides Next's effective pageExtensions (confirmed by recognizing
      // `app/layout.page.tsx` above `[[...locale]]`).
      const postBuildTopLayout = path.join(projectRoot, "app/layout.page.tsx");
      writeFileSync(
        postBuildTopLayout,
        "export default function TopLayout({ children }) { return children; }\n",
      );
      writeFileSync(
        path.join(distDir, "required-server-files.json"),
        JSON.stringify({ config: { pageExtensions: ["page.tsx", "page.jsx"] } }),
      );
      try {
        resetManifest();
        await emitClientCatalogPermutations({
          distDir,
          projectRoot,
          failOnMissing: false,
        });
        expect(evalRenderedEntry()).toMatch(/^static\/chunks\/page\.de-[0-9a-f]{8}\.js$/u);

        // During `runAfterProductionCompile`, a stale required-server-files.json
        // from a previous build must NOT override current pageExtensions.
        resetManifest();
        await emitClientCatalogPermutations({
          distDir,
          projectRoot,
          fromProductionCompileHook: true,
          failOnMissing: false,
        });
        expect(evalRenderedEntry()).toMatch(/^static\/chunks\/page\.en-[0-9a-f]{8}\.js$/u);
      } finally {
        rmSync(postBuildTopLayout, { force: true });
      }

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
    expect(verifyClientCatalogLocaleHeader(signedDe, secret)).toBe("de");
    expect(verifyClientCatalogLocaleHeader(signedEn, secret)).toBe("en");
    expect(verifyClientCatalogLocaleHeader("de", secret)).toBeUndefined();
    expect(verifyClientCatalogLocaleHeader("de.tampered", secret)).toBeUndefined();
    expect(verifyClientCatalogLocaleHeader(signedDe, "other-secret")).toBeUndefined();
    expect(verifyClientCatalogLocaleHeader(null, secret)).toBeUndefined();
    expect(verifyClientCatalogLocaleHeader(undefined, secret)).toBeUndefined();
    expect(() => verifyClientCatalogLocaleHeader(signedDe, "")).toThrow(/non-empty secret/u);
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
