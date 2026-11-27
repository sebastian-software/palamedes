import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

import { transformMacrosNative } from "@palamedes/core-node";
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
  variantPath,
} from "./client-catalog-permutations";

const marker = (key: string) =>
  `"pmds-next:${key}:${Buffer.from(JSON.stringify({ source: "src/a.tsx", ids: ["x"] })).toString("base64url")}"`;
const KEY_A = "aaaaaaaaaaaa";
const KEY_B = "bbbbbbbbbbbb";
const HELLO_COMPILED_ID = transformMacrosNative(
  'import { t } from "@palamedes/core/macro"; export const hello = () => t`Hello`;',
  "page.tsx",
).compiledIds[0]!;

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

  it("embeds optional-root-locale route-tree detection into built manifests from compiled output and never trusts live source edits", async () => {
    const projectRoot = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "palamedes-built-optional-locale-")),
    );
    try {
      // Minimal Palamedes project with two locales and a compiled Turbopack
      // route entry (matching Next 16.4.6 output for server-only layouts that
      // have no client JS/CSS entries).
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
      writeFileSync(
        path.join(projectRoot, "app/shop/[[...locale]]/page.jsx"),
        "export default function Page() { return null; }\n",
      );

      const distDir = path.join(projectRoot, ".next");
      mkdirSync(path.join(distDir, "static/chunks"), { recursive: true });
      mkdirSync(path.join(distDir, "server/app/shop/[[...locale]]"), { recursive: true });
      mkdirSync(path.join(distDir, "server/chunks/ssr"), { recursive: true });
      const payload = Buffer.from(
        JSON.stringify({ source: "app/shop/[[...locale]]/page.jsx", ids: [HELLO_COMPILED_ID] }),
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
      const runtimeChunk = path.join(distDir, "server/chunks/ssr/next_app_page_runtime.js");
      writeFileSync(
        runtimeChunk,
        `module.exports=[59745,a=>{"use strict";var b=a.i(19317),d=a.i(38525);a.s(["f",0,function({tree:O,page:P,pathname:Q,require:R,loadChunk:S,interopDefault:T}){let U={require:R,loadChunk:S},V=new b.AppPageRouteModule({definition:{kind:d.RouteKind.APP_PAGE,page:P,pathname:Q,bundlePath:"",filename:"",appPaths:[]},userland:{loaderTree:O},distDir:".next",relativeProjectDir:""});async function Z(){return null}return{__next_app__:U,routeModule:V,handler:Z}}])},19317,(a,b)=>{b.exports=a.r(18622)},18622,(a,b)=>{b.exports=a.x("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js",()=>require("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js"))}];\n`,
      );
      const templateChunk = path.join(
        distDir,
        "server/chunks/ssr/next_dist_esm_build_templates_app-page_shop.js",
      );
      writeFileSync(
        path.join(distDir, "server/app/shop/[[...locale]]/page.js"),
        `var R=require("../../../chunks/ssr/[turbopack]_runtime.js")("server/app/shop/[[...locale]]/page.js")\nR.c("server/chunks/ssr/next_app_page_runtime.js")\nR.c("server/chunks/ssr/next_dist_esm_build_templates_app-page_shop.js")\nmodule.exports=R.m(1).exports\n`,
      );
      const writeShopTree = (treeExpr: string) => {
        writeFileSync(
          templateChunk,
          `module.exports=[1,a=>{var c=a.i(59745);let j=${treeExpr},m=(0,c.f)({tree:j,page:"/shop/[[...locale]]/page",pathname:"/shop/[[...locale]]",require:r,loadChunk:lc,interopDefault:id}),mp=m.__next_app__,mq=m.routeModule,mr=m.handler;a.s(["__next_app__",0,mp,"handler",0,mr,"routeModule",0,mq],1);}];`,
        );
      };
      const evalShopEntry = () => {
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
            render("/shop/[[...locale]]"),
            unit({ rootParams: {}, headers: header("de") }),
            typeof optionalRootLocale === "boolean" ? { optionalRootLocale } : {},
          ),
        );
        return (ctx.__RSC_MANIFEST as Record<string, { entryJSFiles: Record<string, string[]> }>)[
          "/shop/[[...locale]]/page"
        ]!.entryJSFiles["[project]/app/shop/[[...locale]]/page"]![0]!;
      };

      // Root layout inside app/shop/[[...locale]]/layout.jsx: omitted locale
      // must fall back to "en" instead of trusting x-palamedes-locale.
      writeShopTree(
        `["",{children:["shop",{children:["[[...locale]]",{children:["__PAGE__",{},{page:[p,"[project]/app/shop/[[...locale]]/page.jsx"]},[]]},{layout:[l,"[project]/app/shop/[[...locale]]/layout.jsx"]},[]]},{},[]]},{"global-error":[g,"builtin"]},[]]`,
      );
      await emitClientCatalogPermutations({
        distDir,
        projectRoot,
        failOnMissing: false,
      });
      const rootInsideEntry = evalShopEntry();
      expect(rootInsideEntry).toMatch(/^static\/chunks\/page\.en-[0-9a-f]{8}\.js$/u);
      expect(readFileSync(path.join(distDir, rootInsideEntry), "utf8")).toContain('"Hello"');

      // When compiled-tree inspection is inconclusive (e.g. dynamic options),
      // adding a live app/layout.jsx on disk (as a runAfterProductionCompile
      // hook might do) MUST NOT authorize header selection; it fails closed.
      writeFileSync(
        path.join(projectRoot, "app/layout.jsx"),
        "export default function RootLayout({ children }) { return children; }\n",
      );
      writeFileSync(
        path.join(distDir, "required-server-files.json"),
        JSON.stringify({ config: { pageExtensions: ["tsx", "ts", "jsx", "js"] } }),
      );
      writeFileSync(
        templateChunk,
        `module.exports=[1,a=>{var c=a.i(59745);let m=(0,c.f)(dynamicOpts),mp=m.__next_app__,mq=m.routeModule,mr=m.handler;a.s(["__next_app__",0,mp,"handler",0,mr,"routeModule",0,mq],1);}];`,
      );
      await emitClientCatalogPermutations({
        distDir,
        projectRoot,
        failOnMissing: false,
      });
      expect(evalShopEntry()).toMatch(/^static\/chunks\/page\.en-[0-9a-f]{8}\.js$/u);

      // Only when the compiled route tree itself places a root layout above
      // /shop/[[...locale]] does the route accept the Proxy header.
      writeShopTree(
        `["",{children:["shop",{children:["[[...locale]]",{children:["__PAGE__",{},{page:[p,"[project]/app/shop/[[...locale]]/page.jsx"]},[]]},{},[]]},{},[]]},{layout:[l,"[project]/app/layout.jsx"],"global-error":[g,"builtin"]},[]]`,
      );
      await emitClientCatalogPermutations({
        distDir,
        projectRoot,
        failOnMissing: false,
      });
      const rootAboveEntry = evalShopEntry();
      expect(rootAboveEntry).toMatch(/^static\/chunks\/page\.de-[0-9a-f]{8}\.js$/u);
      expect(readFileSync(path.join(distDir, rootAboveEntry), "utf8")).toContain('"Hallo"');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("embeds optional-root-locale detection for escaped %5F underscore route segments", async () => {
    const projectRoot = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "palamedes-built-escaped-locale-")),
    );
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
      writeFileSync(
        path.join(projectRoot, "app/%5Fshop/[[...locale]]/page.tsx"),
        "export default function Page() { return null; }\n",
      );

      const distDir = path.join(projectRoot, ".next");
      mkdirSync(path.join(distDir, "static/chunks"), { recursive: true });
      mkdirSync(path.join(distDir, "server/app/_shop/[[...locale]]"), { recursive: true });
      mkdirSync(path.join(distDir, "server/chunks/ssr"), { recursive: true });
      const payload = Buffer.from(
        JSON.stringify({ source: "app/%5Fshop/[[...locale]]/page.tsx", ids: [HELLO_COMPILED_ID] }),
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
      writeFileSync(
        path.join(distDir, "server/chunks/ssr/next_app_page_runtime.js"),
        `module.exports=[59745,a=>{"use strict";var b=a.i(19317),d=a.i(38525);a.s(["f",0,function({tree:O,page:P,pathname:Q,require:R,loadChunk:S,interopDefault:T}){let U={require:R,loadChunk:S},V=new b.AppPageRouteModule({definition:{kind:d.RouteKind.APP_PAGE,page:P,pathname:Q,bundlePath:"",filename:"",appPaths:[]},userland:{loaderTree:O},distDir:".next",relativeProjectDir:""});async function Z(){return null}return{__next_app__:U,routeModule:V,handler:Z}}])},19317,(a,b)=>{b.exports=a.r(18622)},18622,(a,b)=>{b.exports=a.x("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js",()=>require("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js"))}];\n`,
      );
      const templateChunk = path.join(
        distDir,
        "server/chunks/ssr/next_dist_esm_build_templates_app-page_escaped.js",
      );
      writeFileSync(
        path.join(distDir, "server/app/_shop/[[...locale]]/page.js"),
        `var R=require("../../../chunks/ssr/[turbopack]_runtime.js")("server/app/_shop/[[...locale]]/page.js")\nR.c("server/chunks/ssr/next_app_page_runtime.js")\nR.c("server/chunks/ssr/next_dist_esm_build_templates_app-page_escaped.js")\nmodule.exports=R.m(1).exports\n`,
      );
      const writeCompiledTree = (treeExpr: string) => {
        writeFileSync(
          templateChunk,
          `module.exports=[1,a=>{var c=a.i(59745);let j=${treeExpr},m=(0,c.f)({tree:j,page:"/_shop/[[...locale]]/page",pathname:"/_shop/[[...locale]]",require:r,loadChunk:lc,interopDefault:id}),mp=m.__next_app__,mq=m.routeModule,mr=m.handler;a.s(["__next_app__",0,mp,"handler",0,mr,"routeModule",0,mq],1);}];`,
        );
      };

      // 1. Root layout sits inside `app/%5Fshop/[[...locale]]/layout.tsx`:
      // classifier returns `true` and omitted segment ignores `x-palamedes-locale: de`.
      writeCompiledTree(
        `["",{children:["_shop",{children:["[[...locale]]",{children:["__PAGE__",{},{page:[p,"[project]/app/%5Fshop/[[...locale]]/page.tsx"]},[]]},{layout:[l,"[project]/app/%5Fshop/[[...locale]]/layout.tsx"]},[]]},{},[]]},{"global-error":[g,"builtin"]},[]]`,
      );
      expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath)).toBe(true);
      const insideReport = await emitClientCatalogPermutations({
        distDir,
        projectRoot,
        failOnMissing: false,
      });
      expect(insideReport.inconclusiveOptionalLocaleRoutes).toEqual([]);

      const evalEscapedManifest = () => {
        const context: Record<string, unknown> = { process: { env: {} } };
        vm.runInNewContext(readFileSync(manifestPath, "utf8"), context);
        const bind = context.__PALAMEDES_CLIENT_CATALOG_BIND as (
          fn: (
            locales: readonly string[],
            fallback: string,
            optionalRootLocale?: boolean,
          ) => string,
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
        return (
          context.__RSC_MANIFEST as Record<string, { entryJSFiles: Record<string, string[]> }>
        )["/_shop/[[...locale]]/page"]!.entryJSFiles[
          "[project]/app/%5Fshop/[[...locale]]/page"
        ]![0]!;
      };

      const insideEntry = evalEscapedManifest();
      expect(insideEntry).toMatch(/^static\/chunks\/page\.en-[0-9a-f]{8}\.js$/u);
      expect(readFileSync(path.join(distDir, insideEntry), "utf8")).toContain('"Hello"');

      // 2. Root layout sits above `[[...locale]]` in `app/%5Fshop/layout.tsx`:
      // classifier returns `false` and omitted segment honors `x-palamedes-locale: de`.
      writeCompiledTree(
        `["",{children:["_shop",{children:["[[...locale]]",{children:["__PAGE__",{},{page:[p,"[project]/app/%5Fshop/[[...locale]]/page.tsx"]},[]]},{},[]]},{layout:[l,"[project]/app/%5Fshop/layout.tsx"]},[]]},{"global-error":[g,"builtin"]},[]]`,
      );
      expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath)).toBe(false);
      const aboveReport = await emitClientCatalogPermutations({
        distDir,
        projectRoot,
        failOnMissing: false,
      });
      expect(aboveReport.inconclusiveOptionalLocaleRoutes).toEqual([]);
      const aboveEntry = evalEscapedManifest();
      expect(aboveEntry).toMatch(/^static\/chunks\/page\.de-[0-9a-f]{8}\.js$/u);
      expect(readFileSync(path.join(distDir, aboveEntry), "utf8")).toContain('"Hallo"');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("derives the root-layout boundary from Next's compiled loaderTree even when wrapper-configured pageExtensions differ", async () => {
    const projectRoot = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "palamedes-compiled-loader-tree-")),
    );
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
      writeFileSync(
        path.join(projectRoot, "app/[[...locale]]/page.page.tsx"),
        "export default function Page() { return null; }\n",
      );

      const distDir = path.join(projectRoot, ".next");
      mkdirSync(path.join(distDir, "static/chunks"), { recursive: true });
      mkdirSync(path.join(distDir, "server/app/[[...locale]]"), { recursive: true });
      mkdirSync(path.join(distDir, "server/chunks/ssr"), { recursive: true });
      const payload = Buffer.from(
        JSON.stringify({ source: "app/[[...locale]]/page.page.tsx", ids: [HELLO_COMPILED_ID] }),
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
      const runtimeModules = `59745,a=>{"use strict";var b=a.i(19317),d=a.i(38525);a.s(["f",0,function({tree:O,page:P,pathname:Q,require:R,loadChunk:S,interopDefault:T}){let U={require:R,loadChunk:S},V=new b.AppPageRouteModule({definition:{kind:d.RouteKind.APP_PAGE,page:P,pathname:Q,bundlePath:"",filename:"",appPaths:[]},userland:{loaderTree:O},distDir:".next",relativeProjectDir:""});async function Z(){return null}return{__next_app__:U,routeModule:V,handler:Z}}])},19317,(a,b)=>{b.exports=a.r(18622)},18622,(a,b)=>{b.exports=a.x("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js",()=>require("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js"))}`;
      const runtimeChunk = path.join(distDir, "server/chunks/ssr/next_app_page_runtime.js");
      writeFileSync(runtimeChunk, `module.exports=[${runtimeModules}];\n`);
      writeFileSync(
        path.join(distDir, "server/app/[[...locale]]/page.js"),
        `var R=require("../../chunks/ssr/[turbopack]_runtime.js")("server/app/[[...locale]]/page.js")\nR.c("server/chunks/ssr/next_app_page_runtime.js")\nR.c("server/chunks/ssr/next_dist_esm_build_templates_app-page_abc.js")\nmodule.exports=R.m(1).exports\n`,
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
      const tpExports = (id: number, treeField: string, page?: string, pathname?: string) =>
        `var c=a.i(59745);let m=${ep(treeField, page, pathname)},mp=m.__next_app__,mq=m.routeModule,mr=m.handler;a.s(["__next_app__",0,mp,"handler",0,mr,"routeModule",0,mq],${id});`;
      const esmEp = (
        body: string,
        treeField: string,
        page = '"/[[...locale]]/page"',
        pathname = '"/[[...locale]]"',
      ) =>
        `import { createAppPageEntrypoint } from "./app-page-runtime"; ${body} const epRes = createAppPageEntrypoint({${treeField},page:${page},pathname:${pathname},require:r,loadChunk:lc,interopDefault:id}); export const __next_app__ = epRes.__next_app__; export const routeModule = epRes.routeModule; export const handler = epRes.handler;`;
      writeFileSync(
        templateChunk,
        `module.exports=[1,a=>{let unrelated=["",{children:["other",{},{},[]]},{layout:[u,"other"]},[]];let j=["",{children:["[[...locale]]",{children:["__PAGE__",{},{metadata:{},page:[p,"[project]/app/[[...locale]]/page.page.tsx"]},[]]},{metadata:{},layout:[l,"[project]/app/[[...locale]]/layout.page.tsx"]},[]]},{"global-error":[g,"builtin"]},[]];${tpExports(1, "tree:j")}}];`,
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
      expect(readFileSync(path.join(distDir, entryFiles[0]!), "utf8")).toContain('"Hello"');

      // When the compiled loaderTree has a root layout at "" above [[...locale]],
      // compiledRouteHasOptionalRootLocale returns false even if no default-named
      // layout file exists.
      writeFileSync(
        templateChunk,
        `module.exports=[1,a=>{let j=["",{children:["[[...locale]]",{children:["__PAGE__",{},{metadata:{},page:[p,"[project]/app/[[...locale]]/page.page.tsx"]},[]]},{metadata:{}},[]]},{layout:[l,"[project]/app/layout.page.tsx"],"global-error":[g,"builtin"]},[]];${tpExports(1, "tree:j")}}];`,
      );
      expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath)).toBe(false);

      // Multi-module chunk: when page.js exports R.m(1).exports, module 2's
      // conflicting tree for the same page must be ignored, and if module 1
      // passes a dynamic options variable, inspection returns undefined.
      writeFileSync(
        templateChunk,
        `module.exports=[2,a=>{let j=["",{},{layout:[l,"[project]/app/layout.page.tsx"]},[]];${tpExports(2, "tree:j")}},1,a=>{var c=a.i(59745);let m=(0,c.f)(dynamicOpts),mp=m.__next_app__,mq=m.routeModule,mr=m.handler;a.s(["__next_app__",0,mp,"handler",0,mr,"routeModule",0,mq],1);}];`,
      );
      expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath)).toBeUndefined();

      // Single-file page.js entry: preserve expectedModuleId from R.m(1).exports
      // so a non-exported module 2 in the same file cannot override an inconclusive
      // exported module 1.
      const singleFilePageEntry = path.join(distDir, "server/app/[[...locale]]/page.js");
      const savedPageEntry = readFileSync(singleFilePageEntry, "utf8");
      try {
        writeFileSync(
          singleFilePageEntry,
          `module.exports=[2,a=>{let j=["",{},{layout:[l,"[project]/app/layout.page.tsx"]},[]];${tpExports(2, "tree:j")}},1,a=>{var c=a.i(59745);let m=(0,c.f)(dynamicOpts),mp=m.__next_app__,mq=m.routeModule,mr=m.handler;a.s(["__next_app__",0,mp,"handler",0,mr,"routeModule",0,mq],1);},${runtimeModules}];\nmodule.exports=R.m(1).exports\n`,
        );
        expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath)).toBeUndefined();
      } finally {
        writeFileSync(singleFilePageEntry, savedPageEntry);
      }

      // Unminified ESM output (`experimental.turbopackMinify: false`) uses
      // shorthand properties such as `{ tree, page: "...", interopDefault }`.
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `import { createAppPageEntrypoint } from "./app-page-runtime";
const tree = ["", {
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
});
export const __next_app__ = entrypoint.__next_app__;
export const routeModule = entrypoint.routeModule;
export const handler = entrypoint.handler;`,
          "/[[...locale]]/page",
        ),
      ).toBe(true);

      // Webpack CJS template (`_export(exports, ...)` + `require("./app-page-runtime")`)
      // also passes entrypoint verification.
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `"use strict";
0 && (module.exports = { __next_app__: null, handler: null, routeModule: null });
_export(exports, {
  __next_app__: function() { return __next_app__; },
  handler: function() { return handler; },
  routeModule: function() { return routeModule; }
});
const _apppageruntime = require("./app-page-runtime");
const tree = ["", { children: ["[[...locale]]", {}, { layout: [l, "layout.tsx"] }] }, {}];
const entrypoint = (0, _apppageruntime.createAppPageEntrypoint)({
  tree,
  page: "/[[...locale]]/page",
  pathname: "/[[...locale]]",
  require: __next_app_require__,
  loadChunk: __next_app_load_chunk__,
  interopDefault: _interopdefault.interopDefault
});
const __next_app__ = entrypoint.__next_app__;
const routeModule = entrypoint.routeModule;
const handler = entrypoint.handler;`,
          "/[[...locale]]/page",
        ),
      ).toBe(true);

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
        `var R=require("../../../chunks/ssr/[turbopack]_runtime.js")("server/app/Bob's recs/[[...locale]]/page.js")\nR.c("server/chunks/ssr/next_app_page_runtime.js")\nR.c("server/chunks/ssr/next_dist_esm_build_templates_app-page_special.js")\nmodule.exports=R.m(2).exports\n`,
      );
      writeFileSync(
        path.join(distDir, "server/chunks/ssr/next_dist_esm_build_templates_app-page_special.js"),
        `module.exports=[2,a=>{let j=["",{children:['Bob\\'s recs',{children:["[[...locale]]",{children:["__PAGE__",{},{metadata:{},page:[p,'[project]/app/Bob\\'s recs/[[...locale]]/page.page.jsx']},[]]},{metadata:{},layout:[l,'[project]/app/Bob\\'s recs/[[...locale]]/layout.page.jsx']},[]]},{metadata:{}},[]]},{"global-error":[g,"builtin"]},[]];${tpExports(2, "tree:j", "'/Bob\\'s recs/[[...locale]]/page'", "'/Bob\\'s recs/[[...locale]]'")}}];`,
      );
      expect(compiledRouteHasOptionalRootLocale(distDir, specialManifestPath)).toBe(true);
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `module.exports=[2,a=>{let j=["",{children:['Bob\\'s "recs"',{children:["[[...locale]]",{children:["__PAGE__",{},{metadata:{},page:[p,'[project]/app/Bob\\'s "recs"/[[...locale]]/page.page.jsx']},[]]},{metadata:{},layout:[l,'[project]/app/Bob\\'s "recs"/[[...locale]]/layout.page.jsx']},[]]},{metadata:{}},[]]},{"global-error":[g,"builtin"]},[]];${tpExports(2, "tree:j", "'/Bob\\'s \"recs\"/[[...locale]]/page'", "'/Bob\\'s \"recs\"/[[...locale]]'")}},${runtimeModules}];`,
          '/Bob\'s "recs"/[[...locale]]/page',
        ),
      ).toBe(true);

      // Diagnostic or unrelated calls — even when carrying all six entrypoint
      // argument fields — and imported wrappers that do not come from Next's
      // app-page-runtime must NOT impersonate the route entrypoint.
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `logDiagnostic({ tree: ["", {}, { layout: [l, "root"] }], page: "/[[...locale]]/page" }); const entrypoint = createAppPageEntrypoint(optionsObj);`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `import { createAppPageEntrypoint } from "./app-page-runtime";
const diag = logDiagnostic({ tree: ["", {}, { layout: [l, "root"] }], page: "/[[...locale]]/page", pathname: "/[[...locale]]", require: r, loadChunk: lc, interopDefault: id });
const entrypoint = createAppPageEntrypoint(optionsObj);
export const __next_app__ = entrypoint.__next_app__;
export const routeModule = entrypoint.routeModule;
export const handler = entrypoint.handler;`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `import { createAppPageEntrypoint } from "./app-page-runtime";
let entrypoint = logDiagnostic({ tree: ["", {}, { layout: [l, "root"] }], page: "/[[...locale]]/page", pathname: "/[[...locale]]", require: r, loadChunk: lc, interopDefault: id });
entrypoint = createAppPageEntrypoint(optionsObj);
export const __next_app__ = entrypoint.__next_app__;
export const routeModule = entrypoint.routeModule;
export const handler = entrypoint.handler;`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `function wrap(opts) { return realCreate({ ...opts, tree: otherTree }); }
const entrypoint = wrap({ tree: ["", {}, { layout: [l, "root"] }], page: "/[[...locale]]/page", pathname: "/[[...locale]]", require: r, loadChunk: lc, interopDefault: id });
export const __next_app__ = entrypoint.__next_app__;
export const routeModule = entrypoint.routeModule;
export const handler = entrypoint.handler;`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      // Imported wrappers (ESM, CJS, and Turbopack) that replace `tree` before
      // calling Next must be rejected by provenance verification.
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `import { createAppPageEntrypoint } from "./custom-wrapper";
const entrypoint = createAppPageEntrypoint({ tree: ["", {}, { layout: [l, "root"] }], page: "/[[...locale]]/page", pathname: "/[[...locale]]", require: r, loadChunk: lc, interopDefault: id });
export const __next_app__ = entrypoint.__next_app__;
export const routeModule = entrypoint.routeModule;
export const handler = entrypoint.handler;`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `_export(exports, { __next_app__: () => __next_app__, handler: () => handler, routeModule: () => routeModule });
const _wrapper = require("./custom-wrapper");
const entrypoint = (0, _wrapper.createAppPageEntrypoint)({ tree: ["", {}, { layout: [l, "root"] }], page: "/[[...locale]]/page", pathname: "/[[...locale]]", require: r, loadChunk: lc, interopDefault: id });
const __next_app__ = entrypoint.__next_app__;
const routeModule = entrypoint.routeModule;
const handler = entrypoint.handler;`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `module.exports=[1,a=>{var c=a.i(99999);let j=["",{},{layout:[l,"root"]}];let m=(0,c.f)({tree:j,page:"/[[...locale]]/page",pathname:"/[[...locale]]",require:r,loadChunk:lc,interopDefault:id}),mp=m.__next_app__,mq=m.routeModule,mr=m.handler;a.s(["__next_app__",0,mp,"handler",0,mr,"routeModule",0,mq],1);},99999,a=>{var real=a.i(59745);a.s(["f",0,function(opts){return(0,real.f)({...opts,tree:otherTree})}])},${runtimeModules}];`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `module.exports=[1,a=>{var c=a.i(59745);let j=["",{},{layout:[l,"root"]}];let unexported=${ep("tree:j")};},${runtimeModules}];`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();

      // Nonliteral `children` references (e.g. a variable or shorthand) are
      // inconclusive and return undefined so emitClientCatalogPermutations()
      // falls back to inspecting the source tree instead of assuming false.
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          esmEp(
            `const child = ["[[...locale]]", {}, { layout: [l, "layout.tsx"] }]; const tree = ["", { children: child }, {}];`,
            "tree",
          ),
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          esmEp(
            `const children = ["[[...locale]]", {}, { layout: [l, "layout.tsx"] }]; const tree = ["", { children }, {}];`,
            "tree",
          ),
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      // A compiled tree whose `children` chain ends without a layout (even
      // after passing `[[...locale]]`) has no confirmed layout boundary and
      // returns undefined so the source-tree / fail-closed fallback runs.
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          esmEp(
            `const tree = ["", { children: ["[[...locale]]", { children: ["__PAGE__", {}, { page: [p, "page.tsx"] }, []] }, {}, []] }, {}, []];`,
            "tree",
          ),
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();

      // Explicit absent layout (`void 0` / `undefined`) on a parent continues down
      // `children` to the real layout under `[[...locale]]`, whereas a dynamic or
      // non-tuple layout expression returns undefined (inconclusive).
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          esmEp(
            `const tree = ["", { children: ["[[...locale]]", {}, { layout: [l, "layout.tsx"] }] }, { layout: void 0 }];`,
            "tree",
          ),
          "/[[...locale]]/page",
        ),
      ).toBe(true);
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          esmEp(
            `const tree = ["", { children: ["[[...locale]]", {}, { layout: [l, "layout.tsx"] }] }, { layout: maybeLayout }];`,
            "tree",
          ),
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      // `layout: null` satisfies `typeof layout !== "undefined"` in Next's
      // `getRootParamsImpl()`, so it must NOT descend past the parent layout;
      // treat it as inconclusive so the source-tree fallback runs.
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          esmEp(
            `const tree = ["", { children: ["[[...locale]]", {}, { layout: [l, "layout.tsx"] }] }, { layout: null }];`,
            "tree",
          ),
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();

      // Lexical scoping: block-scoped `let`/`const` bindings inside sibling
      // functions or earlier modules do not override the outer scope's tree,
      // while mutations, `var` redeclarations, or parameter shadowing return
      // undefined so the caller falls back to the source tree.
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          esmEp(
            `let t=["[[...locale]]",{},{layout:[l,"root"]}]; function other(){let t=["",{},{layout:[o,"otherRoot"]}]; return t}`,
            "tree:t",
          ),
          "/[[...locale]]/page",
        ),
      ).toBe(true);
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `module.exports=[1,a=>{let j=["",{},{layout:[l,"a"]}];${tpExports(1, "tree:j", '"/other/page"', '"/other"')}},2,a=>{let x=1,j=["",{children:["[[...locale]]",{},{layout:[l,"b"]}]},{}];${tpExports(2, "tree:j")}},${runtimeModules}];`,
          "/[[...locale]]/page",
        ),
      ).toBe(true);
      // Deferred entrypoint calls inside a nested function/block capturing an
      // outer tree (which code after the function can mutate before calling it)
      // and destructured property aliases (`const { t: label } = meta`) followed
      // by outer mutation are treated as inconclusive.
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `import { createAppPageEntrypoint } from "./app-page-runtime"; let t=["",{children:["[[...locale]]",{},{layout:[i,"inner"]}]},{layout:[l,"root"]}]; function run(){ return createAppPageEntrypoint({tree:t,page:"/[[...locale]]/page",pathname:"/[[...locale]]",require:r,loadChunk:lc,interopDefault:id}); } t[2]={}; const epRes=run(); export const __next_app__=epRes.__next_app__; export const routeModule=epRes.routeModule; export const handler=epRes.handler;`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          esmEp(
            `let t=["",{children:["[[...locale]]",{},{layout:[i,"inner"]}]},{layout:[l,"root"]}]; { const { t: label } = meta; t[2]={}; }`,
            "tree:t",
          ),
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      // A destructured parameter alias (`function helper({ t: label })`) does
      // not shadow outer `t`, so writes to `t` inside `helper` taint outer `t`.
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          esmEp(
            `let t=["",{children:["[[...locale]]",{},{layout:[i,"inner"]}]},{layout:[l,"root"]}]; function helper({ t: label }){ t[2]={}; return label; } helper(meta);`,
            "tree:t",
          ),
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      // In-place mutations (member writes, method calls, aliasing) or inline
      // chained array expressions (`tree: [...].with(...)`, `children: [...].with(...)`)
      // invalidate the static tree inference and return undefined.
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          esmEp(
            `let t=["",{children:["[[...locale]]",{},{layout:[i,"inner"]}]},{layout:[l,"root"]}]; t[2]={};`,
            "tree:t",
          ),
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          esmEp(
            `let t=["",{children:["[[...locale]]",{},{layout:[i,"inner"]}]},{layout:[l,"root"]}]; mutate(t);`,
            "tree:t",
          ),
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      // Spreading `...t` aliases its inner modules object and must be treated
      // as an intervening reference rather than a property access `.t`.
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          esmEp(
            `let t=["",{children:["[[...locale]]",{},{layout:[i,"inner"]}]},{layout:[l,"root"]}]; const parts=[...t]; delete parts[2].layout;`,
            "tree:t",
          ),
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      // Hoisted functions declared AFTER the entrypoint call in the same scope
      // may already have mutated `t` before the entrypoint runs.
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `${esmEp(`const t=["",{children:["[[...locale]]",{},{layout:[i,"inner"]}]},{layout:[l,"root"]}]; finalizeTree();`, "tree:t")} function finalizeTree(){ delete t[2].layout; }`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      // Sibling entrypoint argument properties that reference or spread `t`
      // (for example `require: makeRequire(t)` or `makeRequire(...t)`) can
      // mutate the tree before the callee runs.
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `import { createAppPageEntrypoint } from "./app-page-runtime"; const t=["",{children:["[[...locale]]",{},{layout:[i,"inner"]}]},{layout:[l,"root"]}]; const epRes = createAppPageEntrypoint({tree:t,page:"/[[...locale]]/page",pathname:"/[[...locale]]",require:makeRequire(t),loadChunk:lc,interopDefault:id}); export const __next_app__=epRes.__next_app__; export const routeModule=epRes.routeModule; export const handler=epRes.handler;`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `import { createAppPageEntrypoint } from "./app-page-runtime"; const t=["",{children:["[[...locale]]",{},{layout:[i,"inner"]}]},{layout:[l,"root"]}]; const epRes = createAppPageEntrypoint({tree:t,page:"/[[...locale]]/page",pathname:"/[[...locale]]",require:makeRequire(...t),loadChunk:lc,interopDefault:id}); export const __next_app__=epRes.__next_app__; export const routeModule=epRes.routeModule; export const handler=epRes.handler;`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          esmEp(
            `let t=["",{children:["[[...locale]]",{},{layout:[i,"inner"]}]},{layout:[l,"root"]}]; const note = \`\${(t[2] = {}, "")}\`;`,
            "tree:t",
          ),
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          esmEp(
            "",
            'tree:["",{children:["[[...locale]]",{},{layout:[i,"inner"]}]},{layout:[l,"root"]}].with(2,{})',
          ),
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          esmEp("", 'tree:["",{children:["[[...locale]]",{},{layout:[i,"inner"]}].with(2,{})},{}]'),
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          esmEp(
            `let t=["[[...locale]]",{},{layout:[l,"root"]}]; function mutate(){t=["",{},{layout:[o,"otherRoot"]}];}`,
            "tree:t",
          ),
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          esmEp(
            `let t=["[[...locale]]",{},{layout:[l,"root"]}]; if (cond) { var t=["",{},{layout:[o,"otherRoot"]}]; }`,
            "tree:t",
          ),
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `import { createAppPageEntrypoint } from "./app-page-runtime"; let t=["",{},{layout:[o,"otherRoot"]}]; function run(t){ const epRes=createAppPageEntrypoint({tree:t,page:"/[[...locale]]/page",pathname:"/[[...locale]]",require:r,loadChunk:lc,interopDefault:id}); return epRes; }`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      // Conditional, chained, or subsequent assignments in the same scope are inconclusive.
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          esmEp(
            `let t=["[[...locale]]",{},{layout:[l,"root"]}]; if (flag) t=["",{},{layout:[o,"otherRoot"]}];`,
            "tree:t",
          ),
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          esmEp(
            `const tree = ["", { children: ["[[...locale]]", {}, { layout: [l, "inner"] }] }, {}].with(2, { layout: [r, "root"] });`,
            "tree",
          ),
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          esmEp(`if (flag) var t=["",{},{layout:[o,"otherRoot"]}];`, "tree:t"),
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      // Serialized route data inside string literals, template literals, or
      // comments must never be treated as a real entrypoint call.
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `const serialized = '${esmEp("", 'tree:["",{},{layout:[l,"root"]}]')}';`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `const serialized = \`${esmEp("", 'tree:["",{},{layout:[l,"root"]}]')}\`;`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      expect(
        compiledLoaderTreeHasOptionalRootLocale(
          `// ${esmEp("", 'tree:["",{},{layout:[l,"root"]}]')}`,
          "/[[...locale]]/page",
        ),
      ).toBeUndefined();
      // Turbopack chunks can register grouped module IDs (`[3042, 77420, factory]`)
      // and bundled factories containing regex literals with delimiters (`/\]/`,
      // `/\}/`, `/\)/`, `/,/`). Verify that both grouped IDs and regex delimiters
      // preceding the Next runtime module are decoded cleanly.
      writeFileSync(
        runtimeChunk,
        `module.exports=[3042,77420,(a,b)=>{const re=/\\]\\}\\)/;if(re.test("x"))/\\],/.test(a);b.exports=re;},${runtimeModules}];\n`,
      );
      writeFileSync(
        templateChunk,
        `module.exports=[10,1,a=>{let j=["",{children:["[[...locale]]",{children:["__PAGE__",{},{metadata:{},page:[p,"[project]/app/[[...locale]]/page.page.tsx"]},[]]},{metadata:{}},[]]},{layout:[l,"[project]/app/layout.page.tsx"],"global-error":[g,"builtin"]},[]];${tpExports(1, "tree:j")}}];`,
      );
      expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath)).toBe(false);

      // Unminified Turbopack (`experimental.turbopackMinify: false`) + experimental
      // React runtime (`experimental.taint: true`): parenthesized arrow factories,
      // bracket-member calls `(0, ns["f"])(...)`, `new ns["AppPageRouteModule"](...)`,
      // `ns["RouteKind"].APP_PAGE`, and `app-page-turbo-experimental.runtime.prod.js`.
      const unminifiedRuntimeChunk = path.join(
        distDir,
        "server/chunks/ssr/next_app_page_runtime_unmin.js",
      );
      writeFileSync(
        unminifiedRuntimeChunk,
        `module.exports = [
59745, ((__turbopack_context__) => {
"use strict";
var __TURBOPACK__imported__module__19317__ = __turbopack_context__.i(19317);
var __TURBOPACK__imported__module__38525__ = __turbopack_context__.i(38525);
function createAppPageEntrypoint({ tree, page, pathname, require: __next_app_require__, loadChunk: __next_app_load_chunk__, interopDefault }) {
  const __next_app__ = {
    require: __next_app_require__,
    loadChunk: __next_app_load_chunk__
  };
  const routeModule = new __TURBOPACK__imported__module__19317__["AppPageRouteModule"]({
    definition: {
      kind: __TURBOPACK__imported__module__38525__["RouteKind"].APP_PAGE,
      page,
      pathname,
      bundlePath: '',
      filename: '',
      appPaths: []
    },
    userland: {
      loaderTree: tree
    }
  });
  async function handler() { return null; }
  return {
    __next_app__,
    routeModule,
    handler
  };
}
__turbopack_context__.s(["f", 0, createAppPageEntrypoint]);
}),
19317, ((__turbopack_context__, module) => {
  if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
  ;
  else {
    if ("TURBOPACK compile-time truthy", 1) {
      module.exports = __turbopack_context__.r(18622);
    } else //TURBOPACK unreachable
    ;
  }
}),
18622, ((__turbopack_context__, module) => {
  var mod = __turbopack_context__.x("next/dist/compiled/next-server/app-page-turbo-experimental.runtime.prod.js", () => require("next/dist/compiled/next-server/app-page-turbo-experimental.runtime.prod.js"));
  module.exports = mod;
})
];\n`,
      );
      writeFileSync(
        templateChunk,
        `module.exports = [
1, ((__turbopack_context__) => {
"use strict";
var __TURBOPACK__imported__module__59745__ = __turbopack_context__.i(59745);
var __TURBOPACK__imported__module__39207__ = __turbopack_context__.i(39207);
const tree = [
  "",
  { "children": ["[[...locale]]", { "children": ["__PAGE__", {}, { "page": [p, "[project]/app/[[...locale]]/page.page.tsx"] }, []] }, {}, []] },
  { "layout": [l, "[project]/app/layout.page.tsx"] },
  []
];
const __next_app_require__ = __turbopack_context__.r.bind(__turbopack_context__);
const __next_app_load_chunk__ = __turbopack_context__.l.bind(__turbopack_context__);
const entrypoint = (0, __TURBOPACK__imported__module__59745__["f"])({
  tree,
  page: "/[[...locale]]/page",
  pathname: "/[[...locale]]",
  require: __next_app_require__,
  loadChunk: __next_app_load_chunk__,
  interopDefault: __TURBOPACK__imported__module__39207__["interopDefault"]
});
const __next_app__ = entrypoint.__next_app__;
const routeModule = entrypoint.routeModule;
const handler = entrypoint.handler;
__turbopack_context__.s(["__next_app__", 0, __next_app__, "handler", 0, handler, "routeModule", 0, routeModule], 1);
}),
];\n`,
      );
      const savedEntryForUnmin = readFileSync(
        path.join(distDir, "server/app/[[...locale]]/page.js"),
        "utf8",
      );
      try {
        writeFileSync(
          path.join(distDir, "server/app/[[...locale]]/page.js"),
          `var R=require("../../chunks/ssr/[turbopack]_runtime.js")("server/app/[[...locale]]/page.js")\nR.c("server/chunks/ssr/next_app_page_runtime_unmin.js")\nR.c("server/chunks/ssr/next_dist_esm_build_templates_app-page_abc.js")\nmodule.exports=R.m(1).exports\n`,
        );
        const sharedChunkCache = new Map<
          string,
          { groups: Array<{ ids: string[]; factory: string }> } | null
        >();
        expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath, sharedChunkCache)).toBe(
          false,
        );
        expect(sharedChunkCache.has(unminifiedRuntimeChunk)).toBe(true);
        // Deleting the shared runtime chunk on disk proves a second page reuses
        // the cached module table without rereading or reparsing the file.
        rmSync(unminifiedRuntimeChunk);
        expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath, sharedChunkCache)).toBe(
          false,
        );
      } finally {
        writeFileSync(path.join(distDir, "server/app/[[...locale]]/page.js"), savedEntryForUnmin);
      }

      // Named Turbopack module IDs (`experimental.turbopackModuleIds: "named"`)
      // + disabled scope hoisting (`experimental.turbopackScopeHoisting: false`):
      // page.js emits double-quoted module IDs with `\"` escapes while chunks
      // emit single-quoted literals, and the entry facade forwards `__next_app__`,
      // `routeModule`, and `handler` via `a.S(...)` to a `<locals>` factory.
      const namedEntryId =
        '[project]/next/dist/esm/build/templates/app-page.js { MODULE_0 => "[project]/app/[[...locale]]/page.tsx" } [app-rsc] (ecmascript)';
      const namedLocalsId = `${namedEntryId} <locals>`;
      const namedRuntimeId =
        "[project]/next/dist/esm/build/templates/app-page-runtime.js [app-rsc] (ecmascript)";
      const namedAppPageModuleId =
        "[project]/next/dist/server/route-modules/app-page/module.compiled.js [app-rsc] (ecmascript)";
      const namedExternalId =
        "[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.prod.js [external] (cjs)";
      const namedRuntimeChunk = path.join(distDir, "server/chunks/ssr/next_named_runtime.js");
      writeFileSync(
        namedRuntimeChunk,
        `module.exports = [
'${namedRuntimeId}', a => { "use strict"; let h = a.i('${namedAppPageModuleId}'); a.s(["f", 0, function({tree:O,page:P,pathname:Q,require:R,loadChunk:S,interopDefault:T}){ let U={require:R,loadChunk:S},V=new h.AppPageRouteModule({definition:{kind:k.RouteKind.APP_PAGE,page:P,pathname:Q,bundlePath:"",filename:"",appPaths:[]},userland:{loaderTree:O}}); async function W(){return null} return {__next_app__:U,routeModule:V,handler:W}; }]); },
'${namedAppPageModuleId}', (a, b) => { b.exports = a.r('${namedExternalId}'); },
'${namedExternalId}', (a, b) => { b.exports = a.x("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js")); }
];\n`,
      );
      const savedEntryForNamed = readFileSync(
        path.join(distDir, "server/app/[[...locale]]/page.js"),
        "utf8",
      );
      try {
        writeFileSync(
          path.join(distDir, "server/app/[[...locale]]/page.js"),
          `var R=require("../../chunks/ssr/[turbopack]_runtime.js")("server/app/[[...locale]]/page.js")\nR.c("server/chunks/ssr/next_named_runtime.js")\nR.c("server/chunks/ssr/next_dist_esm_build_templates_app-page_abc.js")\nmodule.exports=R.m(${JSON.stringify(namedEntryId)}).exports\n`,
        );
        // Single-quoted named IDs with unescaped `"` inside + `a.S(...)` facade
        // forwarding `__next_app__ -> O`, `handler -> N`, `routeModule -> p`.
        writeFileSync(
          templateChunk,
          `module.exports = [
'${namedEntryId}', a => { "use strict"; a.S(['${namedLocalsId}', "__next_app__,O,handler,N,routeModule,p", 0, '[project]/app/[[...locale]]/page.tsx', "default,default"]); },
'${namedLocalsId}', a => { "use strict"; let c = a.i("${namedRuntimeId}"); let j = ["", { children: ["[[...locale]]", { children: ["__PAGE__", {}, { page: [pg, "[project]/app/[[...locale]]/page.tsx"] }, []] }, {}, []] }, { layout: [ly, "[project]/app/layout.tsx"] }, []]; let m = (0, c.f)({ tree: j, page: "/[[...locale]]/page", pathname: "/[[...locale]]", require: k, loadChunk: lc, interopDefault: d.interopDefault }), n = m.__next_app__, o = m.routeModule, p = m.handler; a.s(["O", 0, n, "N", 0, p, "p", 0, o]); }
];\n`,
        );
        expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath)).toBe(false);

        // Namespace-variable head and separate-string-pair syntax in `a.S(...)`
        // also resolve cleanly when forwarding to `<locals>`.
        writeFileSync(
          templateChunk,
          `module.exports = [
'${namedEntryId}', a => { "use strict"; var ns = a.i(${JSON.stringify(namedLocalsId)}); a.S([ns, "__next_app__", "O", "handler", "N", "routeModule", "p"]); },
'${namedLocalsId}', a => { "use strict"; let c = a.i('${namedRuntimeId}'); let j = ["", { children: ["[[...locale]]", { children: ["__PAGE__", {}, { page: [pg, "[project]/app/[[...locale]]/page.tsx"] }, []] }, { layout: [ly, "[project]/app/[[...locale]]/layout.tsx"] }, []] }, {}, []]; let m = (0, c.f)({ tree: j, page: "/[[...locale]]/page", pathname: "/[[...locale]]", require: k, loadChunk: lc, interopDefault: d.interopDefault }), n = m.__next_app__, o = m.routeModule, p = m.handler; a.s(["O", () => (n), "N", () => p, "p", () => o]); }
];\n`,
        );
        expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath)).toBe(true);

        // Non-forwarded sibling factory in the same chunk must still be rejected
        // (strict forwarded module identity).
        writeFileSync(
          templateChunk,
          `module.exports = [
'${namedEntryId}', a => { "use strict"; a.S(['${namedLocalsId}', "__next_app__,O,handler,N,routeModule,p"]); },
'${namedLocalsId}', a => { "use strict"; a.s(["O", 0, 1, "N", 0, 2, "p", 0, 3]); },
'[project]/unrelated-sibling', a => { "use strict"; let c = a.i('${namedRuntimeId}'); let j = ["", { children: ["[[...locale]]", {}, {}, []] }, { layout: [ly, "[project]/app/layout.tsx"] }, []]; let m = (0, c.f)({ tree: j, page: "/[[...locale]]/page", pathname: "/[[...locale]]", require: k, loadChunk: lc, interopDefault: d.interopDefault }), n = m.__next_app__, o = m.routeModule, p = m.handler; a.s(["O", 0, n, "N", 0, p, "p", 0, o]); }
];\n`,
        );
        expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath)).toBeUndefined();

        // Split exports (e.g. `handler` forwarded to a different module while
        // `routeModule` comes from `<locals>`) still resolve `routeModule`
        // independently.
        writeFileSync(
          templateChunk,
          `module.exports = [
'${namedEntryId}', a => { "use strict"; a.S(['${namedLocalsId}', "__next_app__,O,routeModule,p", 0, '[project]/other', "handler,N"]); },
'${namedLocalsId}', a => { "use strict"; let c = a.i('${namedRuntimeId}'); let j = ["", { children: ["[[...locale]]", {}, {}, []] }, { layout: [ly, "[project]/app/layout.tsx"] }, []]; let m = (0, c.f)({ tree: j, page: "/[[...locale]]/page", pathname: "/[[...locale]]", require: k, loadChunk: lc, interopDefault: d.interopDefault }), n = m.__next_app__, o = m.routeModule, p = m.handler; a.s(["O", 0, n, "N", 0, p, "p", 0, o]); }
];\n`,
        );
        expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath)).toBe(false);

        // Turbopack module fragments (`experimental.turbopackModuleFragments: true`):
        // entry -> reexport facade -> split handler / __next_app__ / routeModule
        // fragments -> property extractor (`const c = b.j.routeModule`) ->
        // entrypoint fragment exporting `const n = (0, c.f)({ tree: k, ... })`
        // with 3-element getter+setter `a.s([..., "g", () => k, a => k = a, ..., "j", () => n, a => n = a])`.
        writeFileSync(
          templateChunk,
          `module.exports = [
'${namedEntryId}', a => { "use strict"; var b = a.i(28596); a.S([b, "__next_app__,__next_app__,handler,handler,routeModule,routeModule"]); },
28596, a => { "use strict"; var b = a.i(85694), c = a.i(14822), d = a.i(94566); a.S([b, "handler,f", 0, c, "__next_app__,f", 0, d, "routeModule,f"]); },
94566, a => { "use strict"; var b = a.i(62310); a.S([b, "f,l"]); },
62310, a => { "use strict"; var b = a.i(71829); a.i(21162); const c = b.j.routeModule; a.s(["l", () => c, a => c = a]); },
71829, a => { "use strict"; var c = a.i('${namedRuntimeId}'); const k = ["", { children: ["[[...locale]]", { children: ["__PAGE__", {}, { page: [pg, "[project]/app/[[...locale]]/page.tsx"] }, []] }, {}, []] }, { layout: [ly, "[project]/app/layout.tsx"] }, []], l = a.r.bind(a), m = a.l.bind(a), n = (0, c.f)({ tree: k, page: "/[[...locale]]/page", pathname: "/[[...locale]]", require: l, loadChunk: m, interopDefault: d.interopDefault }); a.s(["g", () => k, a => k = a, "j", () => n, a => n = a]); }
];\n`,
        );
        expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath)).toBe(false);

        // Unminified module fragments (`turbopackModuleFragments: true, turbopackMinify: false`)
        // with bracket access `mod["j"].routeModule` and inline `a.i(...)` chain.
        writeFileSync(
          templateChunk,
          `module.exports = [
'${namedEntryId}', ((__turbopack_context__) => { "use strict"; var b = __turbopack_context__.i(94566); __turbopack_context__.S([b, "routeModule,f"]); }),
94566, ((__turbopack_context__) => { "use strict"; const routeModule = __turbopack_context__.i(71829)["j"].routeModule; __turbopack_context__.s(["f", () => routeModule, (new_rm) => routeModule = new_rm]); }),
71829, ((__turbopack_context__) => { "use strict"; var rt = __turbopack_context__.i('${namedRuntimeId}'); const tree = ["", { children: ["[[...locale]]", { children: ["__PAGE__", {}, { page: [pg, "[project]/app/[[...locale]]/page.tsx"] }, []] }, { layout: [ly, "[project]/app/[[...locale]]/layout.tsx"] }, []] }, {}, []]; const entrypoint = (0, rt["f"])({ tree, page: "/[[...locale]]/page", pathname: "/[[...locale]]", require: __turbopack_context__.r.bind(__turbopack_context__), loadChunk: __turbopack_context__.l.bind(__turbopack_context__), interopDefault: d["interopDefault"] }); __turbopack_context__.s(["g", () => tree, (new_tree) => tree = new_tree, "j", () => entrypoint, (new_ep) => entrypoint = new_ep]); })
];\n`,
        );
        expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath)).toBe(true);

        // Mutable `let` binding exported with a live-binding setter in a fragment
        // must fail closed (unlike `const`, a setter can reassign `let` at runtime).
        writeFileSync(
          templateChunk,
          `module.exports = [
'${namedEntryId}', a => { "use strict"; var b = a.i(62310); a.S([b, "routeModule,l"]); },
62310, a => { "use strict"; var b = a.i(71829); let c = b.j.routeModule; a.s(["l", () => c, a => c = a]); },
71829, a => { "use strict"; var c = a.i('${namedRuntimeId}'); const k = ["", { children: ["[[...locale]]", {}, {}, []] }, { layout: [ly, "[project]/app/layout.tsx"] }, []], n = (0, c.f)({ tree: k, page: "/[[...locale]]/page", pathname: "/[[...locale]]", require: a.r.bind(a), loadChunk: a.l.bind(a), interopDefault: d.interopDefault }); a.s(["g", () => k, a => k = a, "j", () => n, a => n = a]); }
];\n`,
        );
        expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath)).toBeUndefined();

        // Extracting a non-`routeModule` property (e.g. `.handler`) or conflicting
        // duplicate `routeModule` forwards must fail closed.
        writeFileSync(
          templateChunk,
          `module.exports = [
'${namedEntryId}', a => { "use strict"; var b = a.i(62310); a.S([b, "routeModule,l"]); },
62310, a => { "use strict"; var b = a.i(71829); const c = b.j.handler; a.s(["l", () => c, a => c = a]); },
71829, a => { "use strict"; var c = a.i('${namedRuntimeId}'); const k = ["", { children: ["[[...locale]]", {}, {}, []] }, { layout: [ly, "[project]/app/layout.tsx"] }, []], n = (0, c.f)({ tree: k, page: "/[[...locale]]/page", pathname: "/[[...locale]]", require: a.r.bind(a), loadChunk: a.l.bind(a), interopDefault: d.interopDefault }); a.s(["g", () => k, a => k = a, "j", () => n, a => n = a]); }
];\n`,
        );
        expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath)).toBeUndefined();

        // Next 16.4.1 can place strict-mode factories in a leading nested array
        // or strict-mode IIFE at the start of `module.exports = [...]` before
        // outer module factories. Verify both leading nested tables and outer
        // entries are decoded cleanly.
        writeFileSync(
          namedRuntimeChunk,
          `module.exports = [
['${namedRuntimeId}', a => { "use strict"; let h = a.i('${namedAppPageModuleId}'); a.s(["f", 0, function({tree:O,page:P,pathname:Q,require:R,loadChunk:S,interopDefault:T}){ let U={require:R,loadChunk:S},V=new h.AppPageRouteModule({definition:{kind:k.RouteKind.APP_PAGE,page:P,pathname:Q,bundlePath:"",filename:"",appPaths:[]},userland:{loaderTree:O}}); async function W(){return null} return {__next_app__:U,routeModule:V,handler:W}; }]); }],
'${namedAppPageModuleId}', (a, b) => { b.exports = a.r('${namedExternalId}'); },
'${namedExternalId}', (a, b) => { b.exports = a.x("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js")); }
];\n`,
        );
        writeFileSync(
          templateChunk,
          `module.exports = [
[(() => { "use strict"; return ['${namedEntryId}', a => { let c = a.i('${namedRuntimeId}'); let j = ["", { children: ["[[...locale]]", { children: ["__PAGE__", {}, { page: [pg, "[project]/app/[[...locale]]/page.tsx"] }, []] }, {}, []] }, { layout: [ly, "[project]/app/layout.tsx"] }, []]; let m = (0, c.f)({ tree: j, page: "/[[...locale]]/page", pathname: "/[[...locale]]", require: k, loadChunk: lc, interopDefault: d.interopDefault }), n = m.__next_app__, o = m.routeModule, p = m.handler; a.s(["__next_app__", 0, n, "handler", 0, p, "routeModule", 0, o]); }]; })()],
'[project]/outer-after-nested', (a, b) => { b.exports = {}; }
];\n`,
        );
        expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath)).toBe(false);

        // Also test a direct leading nested array (without IIFE) followed by the
        // outer route entrypoint factory.
        writeFileSync(
          templateChunk,
          `module.exports = [
['[project]/strict-helper', a => { a.s([]); }],
'${namedEntryId}', a => { "use strict"; let c = a.i('${namedRuntimeId}'); let j = ["", { children: ["[[...locale]]", { children: ["__PAGE__", {}, { page: [pg, "[project]/app/[[...locale]]/page.tsx"] }, []] }, {}, []] }, { layout: [ly, "[project]/app/layout.tsx"] }, []]; let m = (0, c.f)({ tree: j, page: "/[[...locale]]/page", pathname: "/[[...locale]]", require: k, loadChunk: lc, interopDefault: d.interopDefault }), n = m.__next_app__, o = m.routeModule, p = m.handler; a.s(["__next_app__", 0, n, "handler", 0, p, "routeModule", 0, o]); }
];\n`,
        );
        expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath)).toBe(false);

        // Conflicting factories registered for the same route-module ID across
        // two loaded chunks must fail closed instead of letting the template
        // chunk override the earlier chunk.
        const conflictingChunk = path.join(distDir, "server/chunks/ssr/conflicting_entry.js");
        try {
          writeFileSync(
            conflictingChunk,
            `module.exports = [
'${namedEntryId}', a => { "use strict"; let c = a.i('${namedRuntimeId}'); let j = ["", { children: ["[[...locale]]", { children: ["__PAGE__", {}, { page: [pg, "[project]/app/[[...locale]]/page.tsx"] }, []] }, { layout: [ly, "[project]/app/[[...locale]]/layout.tsx"] }, []] }, {}, []]; let m = (0, c.f)({ tree: j, page: "/[[...locale]]/page", pathname: "/[[...locale]]", require: k, loadChunk: lc, interopDefault: d.interopDefault }), n = m.__next_app__, o = m.routeModule, p = m.handler; a.s(["__next_app__", 0, n, "handler", 0, p, "routeModule", 0, o]); }
];\n`,
          );
          writeFileSync(
            path.join(distDir, "server/app/[[...locale]]/page.js"),
            `var R=require("../../chunks/ssr/[turbopack]_runtime.js")("server/app/[[...locale]]/page.js")\nR.c("server/chunks/ssr/next_named_runtime.js")\nR.c("server/chunks/ssr/conflicting_entry.js")\nR.c("server/chunks/ssr/next_dist_esm_build_templates_app-page_abc.js")\nmodule.exports=R.m(${JSON.stringify(namedEntryId)}).exports\n`,
          );
          expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath)).toBeUndefined();
        } finally {
          rmSync(conflictingChunk, { force: true });
        }

        // Overlapping ID groups across chunks with conflicting factories must
        // taint the ENTIRE connected group (including previously unseen sibling
        // IDs like `71830`), matching Turbopack's `installCompressedModuleFactories()`.
        const overlapChunkA = path.join(distDir, "server/chunks/ssr/overlap_a.js");
        const overlapChunkB = path.join(distDir, "server/chunks/ssr/overlap_b.js");
        try {
          writeFileSync(
            overlapChunkA,
            `module.exports = [
71829, a => { "use strict"; var c = a.i('${namedRuntimeId}'); const k = ["", { children: ["[[...locale]]", {}, { layout: [ly, "[project]/app/[[...locale]]/layout.tsx"] }, []] }, {}, []], n = (0, c.f)({ tree: k, page: "/[[...locale]]/page", pathname: "/[[...locale]]", require: a.r.bind(a), loadChunk: a.l.bind(a), interopDefault: d.interopDefault }); a.s(["j", () => n, a => n = a]); }
];\n`,
          );
          writeFileSync(
            overlapChunkB,
            `module.exports = [
71829, 71830, a => { "use strict"; var c = a.i('${namedRuntimeId}'); const k = ["", { children: ["[[...locale]]", {}, {}, []] }, { layout: [ly, "[project]/app/layout.tsx"] }, []], n = (0, c.f)({ tree: k, page: "/[[...locale]]/page", pathname: "/[[...locale]]", require: a.r.bind(a), loadChunk: a.l.bind(a), interopDefault: d.interopDefault }); a.s(["j", () => n, a => n = a]); }
];\n`,
          );
          writeFileSync(
            templateChunk,
            `module.exports = [
'${namedEntryId}', a => { "use strict"; var b = a.i(62310); a.S([b, "routeModule,l"]); },
62310, a => { "use strict"; var b = a.i(71830); const c = b.j.routeModule; a.s(["l", () => c, a => c = a]); }
];\n`,
          );
          writeFileSync(
            path.join(distDir, "server/app/[[...locale]]/page.js"),
            `var R=require("../../chunks/ssr/[turbopack]_runtime.js")("server/app/[[...locale]]/page.js")\nR.c("server/chunks/ssr/next_named_runtime.js")\nR.c("server/chunks/ssr/overlap_a.js")\nR.c("server/chunks/ssr/overlap_b.js")\nR.c("server/chunks/ssr/next_dist_esm_build_templates_app-page_abc.js")\nmodule.exports=R.m(${JSON.stringify(namedEntryId)}).exports\n`,
          );
          expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath)).toBeUndefined();
        } finally {
          rmSync(overlapChunkA, { force: true });
          rmSync(overlapChunkB, { force: true });
        }

        // A second chunk whose filename also matches `next_dist_build_templates_app-page_`
        // (for example a user route segment named `next_dist_build_templates_app-page_store`)
        // must NOT cause ambiguity when `page.js` names its exact entry module ID.
        // Also verify shared runtime factories using `ctx.s([...], modId)` with
        // duplicate minified export names across distinct module IDs, and
        // parenthesized `module.exports = ([...])` vs unparsed `module.exports = wrap([...])`.
        const collidingFilenameChunk = path.join(
          distDir,
          "server/chunks/ssr/next_dist_build_templates_app-page_store_chunk.js",
        );
        const unparsedChunk = path.join(distDir, "server/chunks/ssr/unparsed_wrapper_chunk.js");
        try {
          writeFileSync(
            namedRuntimeChunk,
            `module.exports = ([
'[project]/other-shared-mod', '${namedRuntimeId}', a => { "use strict"; let h = a.i('${namedAppPageModuleId}'); a.s(["f", 0, function otherHelper() { return null; }], '[project]/other-shared-mod'); a.s(["f", 0, function({tree:O,page:P,pathname:Q,require:R,loadChunk:S,interopDefault:T}){ let U={require:R,loadChunk:S},V=new h.AppPageRouteModule({definition:{kind:k.RouteKind.APP_PAGE,page:P,pathname:Q,bundlePath:"",filename:"",appPaths:[]},userland:{loaderTree:O}}); async function W(){return null} return {__next_app__:U,routeModule:V,handler:W}; }], '${namedRuntimeId}'); },
'${namedAppPageModuleId}', (a, b) => { b.exports = a.r('${namedExternalId}'); },
'${namedExternalId}', (a, b) => { b.exports = a.x("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js")); }
]);\n`,
          );
          writeFileSync(
            collidingFilenameChunk,
            `module.exports = [92e3, async a => { using handle = { [Symbol.dispose]() {} }; let counter = /\\p{Script=Tolong_Siki}/u.test("a") ? 2 : 1; const { of, period } = { of: 72, period: "km/h" }; const scale = unit => (unit === "m/s" ? 1 : 3.6); const speed = of / scale(period ?? "km/h"); const half = counter++ / 2; const ratio = obj.return / 2; const metric = metrics.with(params) / 2; for await (const line of lines) /\\]$/.test(line) && counter++; const link = { href: "/shop/" + speed + half + ratio + metric, handle }; a.s(["default", 0, link]); }, '[project]/user-page-mod', a => { a.s([]); }];\n`,
          );
          writeFileSync(
            templateChunk,
            `module.exports = [
'${namedEntryId}', a => { "use strict"; let c = a.i('${namedRuntimeId}'); let j = ["", { children: ["[[...locale]]", { children: ["__PAGE__", {}, { page: [pg, "[project]/app/[[...locale]]/page.tsx"] }, []] }, {}, []] }, { layout: [ly, "[project]/app/layout.tsx"] }, []]; let m = (0, c.f)({ tree: j, page: "/[[...locale]]/page", pathname: "/[[...locale]]", require: k, loadChunk: lc, interopDefault: d.interopDefault }), n = m.__next_app__, o = m.routeModule, p = m.handler; a.s(["__next_app__", 0, n, "handler", 0, p, "routeModule", 0, o]); }
];\n`,
          );
          writeFileSync(
            path.join(distDir, "server/app/[[...locale]]/page.js"),
            `var R=require("../../chunks/ssr/[turbopack]_runtime.js")("server/app/[[...locale]]/page.js")\nR.c("server/chunks/ssr/next_named_runtime.js")\nR.c("server/chunks/ssr/next_dist_build_templates_app-page_store_chunk.js")\nR.c("server/chunks/ssr/next_dist_esm_build_templates_app-page_abc.js")\nmodule.exports=R.m(${JSON.stringify(namedEntryId)}).exports\n`,
          );
          expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath)).toBe(false);

          // Shadowed lexical bindings inside nested runtime handlers (for
          // example `tree: c` with an inner `let c = ...` inside `handler`)
          // must not be treated as writes to the outer `tree` parameter, while
          // an unshadowed write to `c` inside the handler still fails closed.
          writeFileSync(
            namedRuntimeChunk,
            `module.exports = ([
'${namedRuntimeId}', a => { "use strict"; let h = a.i('${namedAppPageModuleId}'); a.s(["f", 0, function({tree:c,page:P,pathname:Q,require:R,loadChunk:S,interopDefault:T}){ let U={require:R,loadChunk:S},r=new h.AppPageRouteModule({definition:{kind:k.RouteKind.APP_PAGE,page:P,pathname:Q,bundlePath:"",filename:"",appPaths:[]},userland:{loaderTree:c}}); async function W(){ let c = 1; c = 2; return c; } return {__next_app__:U,routeModule:r,handler:W}; }], '${namedRuntimeId}'); },
'${namedAppPageModuleId}', (a, b) => { b.exports = a.r('${namedExternalId}'); },
'${namedExternalId}', (a, b) => { b.exports = a.x("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js")); }
]);\n`,
          );
          writeFileSync(
            path.join(distDir, "server/app/[[...locale]]/page.js"),
            `var R=require("../../chunks/ssr/[turbopack]_runtime.js")("server/app/[[...locale]]/page.js")\nR.c("server/chunks/ssr/next_named_runtime.js")\nR.c("server/chunks/ssr/next_dist_esm_build_templates_app-page_abc.js")\nmodule.exports=R.m(${JSON.stringify(namedEntryId)}).exports\n`,
          );
          expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath)).toBe(false);

          // Unminified module fragments with unused-export removal disabled can
          // register `a.s(["tree", () => j, a => j = a])` BEFORE `const j = [...]`.
          // Verify that a `const` binding still resolves cleanly while a mutable
          // `let` binding with a registered setter fails closed.
          writeFileSync(
            templateChunk,
            `module.exports = [
'${namedEntryId}', a => { "use strict"; a.s(["tree", () => j, a => j = a, "__next_app__", () => n, "handler", () => p, "routeModule", () => o]); let c = a.i('${namedRuntimeId}'); const j = ["", { children: ["[[...locale]]", { children: ["__PAGE__", {}, { page: [pg, "[project]/app/[[...locale]]/page.tsx"] }, []] }, {}, []] }, { layout: [ly, "[project]/app/layout.tsx"] }, []]; const m = (0, c.f)({ tree: j, page: "/[[...locale]]/page", pathname: "/[[...locale]]", require: k, loadChunk: lc, interopDefault: d.interopDefault }), n = m.__next_app__, o = m.routeModule, p = m.handler; }
];\n`,
          );
          expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath)).toBe(false);

          writeFileSync(
            templateChunk,
            `module.exports = [
'${namedEntryId}', a => { "use strict"; a.s(["tree", () => j, a => j = a, "__next_app__", () => n, "handler", () => p, "routeModule", () => o]); let c = a.i('${namedRuntimeId}'); let j = ["", { children: ["[[...locale]]", { children: ["__PAGE__", {}, { page: [pg, "[project]/app/[[...locale]]/page.tsx"] }, []] }, {}, []] }, { layout: [ly, "[project]/app/layout.tsx"] }, []]; const m = (0, c.f)({ tree: j, page: "/[[...locale]]/page", pathname: "/[[...locale]]", require: k, loadChunk: lc, interopDefault: d.interopDefault }), n = m.__next_app__, o = m.routeModule, p = m.handler; }
];\n`,
          );
          expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath)).toBeUndefined();

          // Restore standard template chunk for subsequent assertions.
          writeFileSync(
            templateChunk,
            `module.exports = [
'${namedEntryId}', a => { "use strict"; let c = a.i('${namedRuntimeId}'); let j = ["", { children: ["[[...locale]]", { children: ["__PAGE__", {}, { page: [pg, "[project]/app/[[...locale]]/page.tsx"] }, []] }, {}, []] }, { layout: [ly, "[project]/app/layout.tsx"] }, []]; let m = (0, c.f)({ tree: j, page: "/[[...locale]]/page", pathname: "/[[...locale]]", require: k, loadChunk: lc, interopDefault: d.interopDefault }), n = m.__next_app__, o = m.routeModule, p = m.handler; a.s(["__next_app__", 0, n, "handler", 0, p, "routeModule", 0, o]); }
];\n`,
          );

          writeFileSync(
            namedRuntimeChunk,
            `module.exports = ([
'${namedRuntimeId}', a => { "use strict"; let h = a.i('${namedAppPageModuleId}'); a.s(["f", 0, function({tree:c,page:P,pathname:Q,require:R,loadChunk:S,interopDefault:T}){ let U={require:R,loadChunk:S},r=new h.AppPageRouteModule({definition:{kind:k.RouteKind.APP_PAGE,page:P,pathname:Q,bundlePath:"",filename:"",appPaths:[]},userland:{loaderTree:c}}); async function W(){ c = tampered; return null; } return {__next_app__:U,routeModule:r,handler:W}; }], '${namedRuntimeId}'); },
'${namedAppPageModuleId}', (a, b) => { b.exports = a.r('${namedExternalId}'); },
'${namedExternalId}', (a, b) => { b.exports = a.x("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js")); }
]);\n`,
          );
          expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath)).toBeUndefined();

          // Minified single-letter routeModule local bindings (`r` colliding with
          // `require`, or `l` colliding with `loadChunk`) must use the captured
          // declaration offset rather than `indexOf(routeModVar, ...)`, while a
          // real reassignment of `r` still fails closed.
          writeFileSync(
            namedRuntimeChunk,
            `module.exports = ([
'${namedRuntimeId}', a => { "use strict"; let h = a.i('${namedAppPageModuleId}'); a.s(["f", 0, function({tree:O,page:P,pathname:Q,require:R,loadChunk:S,interopDefault:T}){ let U={require:R,loadChunk:S},r=new h.AppPageRouteModule({definition:{kind:k.RouteKind.APP_PAGE,page:P,pathname:Q,bundlePath:"",filename:"",appPaths:[]},userland:{loaderTree:O}}); async function W(){return null} return {__next_app__:U,routeModule:r,handler:W}; }], '${namedRuntimeId}'); },
'${namedAppPageModuleId}', (a, b) => { b.exports = a.r('${namedExternalId}'); },
'${namedExternalId}', (a, b) => { b.exports = a.x("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js")); }
]);\n`,
          );
          writeFileSync(
            path.join(distDir, "server/app/[[...locale]]/page.js"),
            `var R=require("../../chunks/ssr/[turbopack]_runtime.js")("server/app/[[...locale]]/page.js")\nR.c("server/chunks/ssr/next_named_runtime.js")\nR.c("server/chunks/ssr/next_dist_esm_build_templates_app-page_abc.js")\nmodule.exports=R.m(${JSON.stringify(namedEntryId)}).exports\n`,
          );
          expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath)).toBe(false);

          writeFileSync(
            namedRuntimeChunk,
            `module.exports = ([
'${namedRuntimeId}', a => { "use strict"; let h = a.i('${namedAppPageModuleId}'); a.s(["f", 0, function({tree:O,page:P,pathname:Q,require:R,loadChunk:S,interopDefault:T}){ let U={require:R,loadChunk:S},r=new h.AppPageRouteModule({definition:{kind:k.RouteKind.APP_PAGE,page:P,pathname:Q,bundlePath:"",filename:"",appPaths:[]},userland:{loaderTree:O}}); r = tampered; async function W(){return null} return {__next_app__:U,routeModule:r,handler:W}; }], '${namedRuntimeId}'); },
'${namedAppPageModuleId}', (a, b) => { b.exports = a.r('${namedExternalId}'); },
'${namedExternalId}', (a, b) => { b.exports = a.x("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js")); }
]);\n`,
          );
          expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath)).toBeUndefined();

          // Quoted `R.c(...)` chunk paths containing apostrophes (for example
          // Next's actions chunk for a `today's` route) must be parsed as JS
          // string literals so they are never silently dropped, and unrecognized
          // chunk-load arguments must fail closed as inconclusive.
          const apostropheChunk = path.join(
            distDir,
            "server/chunks/ssr/1whs__next-internal_server_app_today's_page_actions_abc.js",
          );
          try {
            writeFileSync(
              namedRuntimeChunk,
              `module.exports = ([
'${namedRuntimeId}', a => { "use strict"; let h = a.i('${namedAppPageModuleId}'); a.s(["f", 0, function({tree:O,page:P,pathname:Q,require:R,loadChunk:S,interopDefault:T}){ let U={require:R,loadChunk:S},r=new h.AppPageRouteModule({definition:{kind:k.RouteKind.APP_PAGE,page:P,pathname:Q,bundlePath:"",filename:"",appPaths:[]},userland:{loaderTree:O}}); async function W(){return null} return {__next_app__:U,routeModule:r,handler:W}; }], '${namedRuntimeId}'); },
'${namedAppPageModuleId}', (a, b) => { b.exports = a.r('${namedExternalId}'); },
'${namedExternalId}', (a, b) => { b.exports = a.x("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js")); }
]);\n`,
            );
            writeFileSync(
              apostropheChunk,
              `module.exports = ['[project]/today-actions', a => { a.s([]); }];\n`,
            );
            writeFileSync(
              path.join(distDir, "server/app/[[...locale]]/page.js"),
              `var R=require("../../chunks/ssr/[turbopack]_runtime.js")("server/app/[[...locale]]/page.js")\nR.c("server/chunks/ssr/next_named_runtime.js")\nR.c("server/chunks/ssr/1whs__next-internal_server_app_today's_page_actions_abc.js")\nR.c("server/chunks/ssr/next_dist_esm_build_templates_app-page_abc.js")\nmodule.exports=R.m(${JSON.stringify(namedEntryId)}).exports\n`,
            );
            expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath)).toBe(false);

            // If the apostrophe-named chunk registers a conflicting factory for
            // the entry module ID, fail closed instead of dropping the chunk.
            writeFileSync(
              apostropheChunk,
              `module.exports = ['${namedEntryId}', a => { a.s([]); }];\n`,
            );
            expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath)).toBeUndefined();

            // Commented-out `module.exports` statements before the live export
            // must be ignored, while a later assignment that overwrites the
            // Turbopack export with another value must fail closed.
            writeFileSync(
              path.join(distDir, "server/app/[[...locale]]/page.js"),
              `// module.exports=R.m(999999).exports\nvar R=require("../../chunks/ssr/[turbopack]_runtime.js")("server/app/[[...locale]]/page.js")\nR.c("server/chunks/ssr/next_named_runtime.js")\nR.c("server/chunks/ssr/next_dist_esm_build_templates_app-page_abc.js")\nmodule.exports=R.m(${JSON.stringify(namedEntryId)}).exports\n`,
            );
            expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath)).toBe(false);

            writeFileSync(
              path.join(distDir, "server/app/[[...locale]]/page.js"),
              `var R=require("../../chunks/ssr/[turbopack]_runtime.js")("server/app/[[...locale]]/page.js")\nR.c("server/chunks/ssr/next_named_runtime.js")\nR.c("server/chunks/ssr/next_dist_esm_build_templates_app-page_abc.js")\nmodule.exports=R.m(${JSON.stringify(namedEntryId)}).exports\nmodule.exports=overwrittenExports\n`,
            );
            expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath)).toBeUndefined();

            // Non-literal chunk-load arguments fail closed as inconclusive.
            writeFileSync(
              path.join(distDir, "server/app/[[...locale]]/page.js"),
              `var R=require("../../chunks/ssr/[turbopack]_runtime.js")("server/app/[[...locale]]/page.js")\nR.c("server/chunks/ssr/next_named_runtime.js")\nR.c(dynamicChunkPath)\nR.c("server/chunks/ssr/next_dist_esm_build_templates_app-page_abc.js")\nmodule.exports=R.m(${JSON.stringify(namedEntryId)}).exports\n`,
            );
            expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath)).toBeUndefined();
          } finally {
            rmSync(apostropheChunk, { force: true });
          }

          // An unparseable sibling chunk (for example `module.exports = wrap([...])`)
          // must fail closed rather than being treated as an empty factory table.
          writeFileSync(
            unparsedChunk,
            `module.exports = wrap(['${namedEntryId}', a => { a.s([]); }]);\n`,
          );
          writeFileSync(
            path.join(distDir, "server/app/[[...locale]]/page.js"),
            `var R=require("../../chunks/ssr/[turbopack]_runtime.js")("server/app/[[...locale]]/page.js")\nR.c("server/chunks/ssr/next_named_runtime.js")\nR.c("server/chunks/ssr/unparsed_wrapper_chunk.js")\nR.c("server/chunks/ssr/next_dist_esm_build_templates_app-page_abc.js")\nmodule.exports=R.m(${JSON.stringify(namedEntryId)}).exports\n`,
          );
          expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath)).toBeUndefined();
        } finally {
          rmSync(collidingFilenameChunk, { force: true });
          rmSync(unparsedChunk, { force: true });
        }
      } finally {
        writeFileSync(path.join(distDir, "server/app/[[...locale]]/page.js"), savedEntryForNamed);
        rmSync(namedRuntimeChunk, { force: true });
      }

      // End-to-end fail-closed check: when compiled-tree inspection is
      // inconclusive (for example a missing page entry or nonliteral children),
      // emitClientCatalogPermutations() always sets optionalRootLocale=true so
      // an omitted segment ignores x-palamedes-locale — even if a hook or later
      // edit created `app/layout.page.tsx` or `app/layout.tsx` on disk.
      const missingSourceRoot = realpathSync(
        mkdtempSync(path.join(os.tmpdir(), "palamedes-missing-src-root-")),
      );
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
        // Server-only `[[...locale]]` routes without affected client chunks
        // must skip route-tree inspection and avoid spurious inconclusive warnings.
        mkdirSync(path.join(missingDist, "server/app/server-only/[[...locale]]"), {
          recursive: true,
        });
        writeFileSync(
          path.join(
            missingDist,
            "server/app/server-only/[[...locale]]/page_client-reference-manifest.js",
          ),
          `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};
globalThis.__RSC_MANIFEST["/server-only/[[...locale]]/page"] = ${JSON.stringify({
            entryCSSFiles: {},
            entryJSFiles: {
              "[project]/app/server-only/[[...locale]]/page": ["static/chunks/neutral.js"],
            },
          })};`,
        );
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
          const inconclusiveReport = await emitClientCatalogPermutations({
            distDir: missingDist,
            projectRoot: missingSourceRoot,
            failOnMissing: false,
          });
          expect(inconclusiveReport.inconclusiveOptionalLocaleRoutes).toEqual([
            "/generated/[[...locale]]/page",
          ]);
          expect(warnSpy).toHaveBeenCalledWith(
            expect.stringMatching(
              /could not verify the compiled root-layout boundary for \/generated\/\[\[\.\.\.locale\]\]\/page.*localeSource: "header", headerSecret/u,
            ),
          );
        } finally {
          warnSpy.mockRestore();
        }
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
        `var R=require("../../chunks/ssr/[turbopack]_runtime.js")("server/app/[[...locale]]/page.js")\nR.c("server/chunks/ssr/next_app_page_runtime.js")\nR.c("server/chunks/ssr/next_dist_esm_build_templates_app-page_abc.js")\nR.c("server/chunks/ssr/my_app-page_helper.js")\nmodule.exports=R.m(1).exports\n`,
      );
      writeFileSync(
        templateChunk,
        `module.exports=[1,a=>{let child=["[[...locale]]",{},{layout:[l,"[project]/app/[[...locale]]/layout.page.tsx"]},[]];let j=["",{children:child},{"global-error":[g,"builtin"]},[]];let m=(0,c.f)({tree:j,page:"/[[...locale]]/page",pathname:"/[[...locale]]"});}];`,
      );
      expect(compiledRouteHasOptionalRootLocale(distDir, manifestPath)).toBeUndefined();

      // If no entrypoint binds `tree` for this page, return undefined so
      // emitClientCatalogPermutations() fails closed instead of trusting an
      // unrelated array.
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
    // Proxy header signing must stay isolated from filesystem manifest binding
    // so importing it from `proxy.ts` does not trigger whole-project NFT tracing.
    const headerModuleSource = readFileSync(
      path.join(import.meta.dirname, "client-catalog-header.ts"),
      "utf8",
    );
    expect(headerModuleSource).not.toMatch(/node:fs|node:path|client-catalog-binding/u);
    const serverModuleSource = readFileSync(path.join(import.meta.dirname, "server.ts"), "utf8");
    expect(serverModuleSource).toMatch(
      /signClientCatalogLocaleHeader[\s\S]*from "\.\/client-catalog-header"/u,
    );
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
