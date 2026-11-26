import { createHash } from "node:crypto";
import vm from "node:vm";

import { describe, expect, it, vi } from "vitest";

import {
  bindClientCatalogPermutationsAt,
  manifestHasOptionalRootLocale,
  resolveRenderLocale,
  signClientCatalogLocaleHeader,
} from "./client-catalog-binding";
import {
  type ChunkGraph,
  affectedChunks,
  assertNoBootstrapChunks,
  assertChunkCoverage,
  chunkReferences,
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
    // Manifest inspection distinguishes root vs nested optional locale layouts
    // without triggering any chunk array getters.
    expect(
      manifestHasOptionalRootLocale({
        __RSC_MANIFEST: {
          "/[[...locale]]/page": {
            entryJSFiles: {
              "[project]/src/app/[[...locale]]/layout": [],
              "[project]/src/app/[[...locale]]/page": [],
            },
          },
        },
      }),
    ).toBe(true);
    expect(
      manifestHasOptionalRootLocale({
        __RSC_MANIFEST: {
          "/shop/[[...locale]]/page": {
            entryJSFiles: {
              "[project]/src/app/layout": [],
              "[project]/src/app/shop/[[...locale]]/layout": [],
              "[project]/src/app/shop/[[...locale]]/page": [],
            },
          },
        },
      }),
    ).toBe(false);
    expect(
      manifestHasOptionalRootLocale({
        __RSC_MANIFEST: {
          "/[[...locale]]/page": {
            entryJSFiles: {
              "[project]/src/app/layout": [],
              "[project]/src/app/[[...locale]]/page": [],
            },
          },
        },
      }),
    ).toBe(false);
    expect(
      manifestHasOptionalRootLocale({
        __RSC_MANIFEST: {
          "/shop/[[...locale]]/page": {
            entryJSFiles: {
              "[project]/src/app/shop/[[...locale]]/layout": [],
              "[project]/src/app/shop/[[...locale]]/page": [],
            },
          },
        },
      }),
    ).toBe(true);
    const throwingEntryJSFiles: Record<string, unknown> = {};
    Object.defineProperty(throwingEntryJSFiles, "[project]/src/app/[[...locale]]/layout", {
      enumerable: false,
      get() {
        throw new Error("chunk getter must not be invoked during manifest inspection");
      },
    });
    expect(
      manifestHasOptionalRootLocale({
        __RSC_MANIFEST: {
          "/[[...locale]]/page": { entryJSFiles: throwingEntryJSFiles },
        },
      }),
    ).toBe(true);
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
