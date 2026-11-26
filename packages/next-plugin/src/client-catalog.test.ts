import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

declare global {
  var __pmds_test_asset_attempts: number | undefined;
}

type ClientCatalogModule = { loadClientCatalog(marker: string): Promise<Record<string, unknown>> };

// The helper ships as plain browser ESM without declarations.
const clientCatalogUrl = new URL("../client-catalog.mjs", import.meta.url).href;
const KEY = "0123456789ab";
const MARKER = `pmds-next:${KEY}:${Buffer.from(
  JSON.stringify({ source: "src/components/Greeting.tsx", ids: ["a"] }),
).toString("base64url")}`;
const APP_ORIGIN = "https://app.example";
const CDN_ORIGIN = "https://cdn.example.com";
const TEST_ORIGINS = new Set([APP_ORIGIN, CDN_ORIGIN]);

let assetDir: string;
let deregisterHooks: (() => void) | undefined;

class FakeHTMLLinkElement {
  public href: string;
  public rel: string;
  public parentElement: unknown;

  public constructor(href: string, rel = "modulepreload", parentElement?: unknown) {
    this.href = href;
    this.rel = rel;
    this.parentElement = parentElement;
  }
}

beforeAll(() => {
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith("https://") && assetDir) {
        const parsed = new URL(specifier);
        if (
          TEST_ORIGINS.has(parsed.origin) &&
          parsed.pathname.includes("/_next/static/palamedes/")
        ) {
          const fileName = parsed.pathname.slice(parsed.pathname.lastIndexOf("/") + 1);
          const target = `${pathToFileURL(path.join(assetDir, fileName)).href}${parsed.search}`;
          return { shortCircuit: true, url: target };
        }
      }
      return nextResolve(specifier, context);
    },
  });
  deregisterHooks = () => hooks.deregister();
});

afterAll(() => {
  deregisterHooks?.();
});

// A DOM-less document: the map link in <head>, <html lang>, and the page
// location that validates same-origin and configured asset prefixes.
let mapCount = 0;
async function stubDocument(
  map: { locale: string; assets: Record<string, string> },
  lang = "de",
  options: { origin?: string; basePath?: string; rawAssets?: Record<string, string> } = {},
) {
  const assets: Record<string, string> = options.rawAssets ? { ...options.rawAssets } : {};
  for (const [key, fileName] of Object.entries(map.assets)) {
    assets[fileName] = (assets[fileName] ?? "") + key;
  }
  const mapName = `catalogs.${(mapCount += 1)}.mjs`;
  await writeAsset(mapName, `export default ${JSON.stringify({ locale: map.locale, assets })};`);
  const origin = options.origin ?? APP_ORIGIN;
  const basePath = options.basePath ?? "";
  stubDocumentLink(`${origin}${basePath}/_next/static/palamedes/${mapName}`, lang);
}

function stubDocumentLink(
  href: string,
  lang = "de",
  options: {
    element?: unknown;
    head?: object | null;
    locationHref?: string;
    rel?: string;
    parentElement?: unknown;
  } = {},
) {
  const head = options.head === undefined ? { tagName: "HEAD" } : options.head;
  const link =
    options.element !== undefined
      ? options.element
      : new FakeHTMLLinkElement(
          href,
          options.rel ?? "modulepreload",
          options.parentElement === undefined ? head : options.parentElement,
        );
  vi.stubGlobal("HTMLLinkElement", FakeHTMLLinkElement);
  vi.stubGlobal("location", {
    href: options.locationHref ?? `${APP_ORIGIN}/${lang}`,
    origin: new URL(options.locationHref ?? `${APP_ORIGIN}/${lang}`).origin,
  });
  vi.stubGlobal("document", {
    baseURI: `${APP_ORIGIN}/${lang}`,
    head,
    documentElement: { lang },
    readyState: "complete",
    addEventListener: vi.fn(),
    getElementById: (id: string) => (id === "palamedes-client-catalogs" ? link : null),
  });
}

async function writeAsset(name: string, source: string) {
  const file = path.join(assetDir, name);
  await writeFile(file, source);
  return name;
}

// The module memoizes the document map, so each test loads a fresh copy.
async function loadModule(): Promise<ClientCatalogModule> {
  vi.resetModules();
  return (await import(clientCatalogUrl)) as ClientCatalogModule;
}

beforeEach(async () => {
  assetDir = await mkdtemp(path.join(os.tmpdir(), "pmds-client-catalog-"));
  globalThis.__pmds_test_asset_attempts = 0;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete globalThis.__pmds_test_asset_attempts;
  await rm(assetDir, { recursive: true, force: true });
});

describe("loadClientCatalog", () => {
  it("returns the messages of the module's asset", async () => {
    const fileName = await writeAsset("chunk.de.js", 'export const messages = { a: "Hallo" };');
    await stubDocument({ locale: "de", assets: { [KEY]: fileName } });
    const { loadClientCatalog } = await loadModule();

    await expect(loadClientCatalog(MARKER)).resolves.toEqual({ a: "Hallo" });
  });

  it("supports configured basePath and cross-origin assetPrefix", async () => {
    const fileName = await writeAsset("cdn.de.js", 'export const messages = { a: "Hallo" };');
    vi.stubEnv("PALAMEDES_NEXT_CATALOG_BASE", "/shop/_next/static/palamedes/");
    await stubDocument({ locale: "de", assets: { [KEY]: fileName } }, "de", { basePath: "/shop" });
    const withBasePath = await loadModule();
    await expect(withBasePath.loadClientCatalog(MARKER)).resolves.toEqual({ a: "Hallo" });

    vi.stubEnv("PALAMEDES_NEXT_CATALOG_BASE", `${CDN_ORIGIN}/_next/static/palamedes/`);
    await stubDocument({ locale: "de", assets: { [KEY]: fileName } }, "de", {
      origin: CDN_ORIGIN,
    });
    const withCdn = await loadModule();
    await expect(withCdn.loadClientCatalog(MARKER)).resolves.toEqual({ a: "Hallo" });
  });

  it("retries a failed import once under a distinct URL", async () => {
    // The first evaluation fails like a dropped request. Re-importing the same
    // URL would return that cached failure; the retry query avoids it.
    const fileName = await writeAsset(
      "flaky.de.js",
      `globalThis.__pmds_test_asset_attempts += 1;
if (globalThis.__pmds_test_asset_attempts === 1) throw new Error("dropped");
export const messages = { a: "Hallo" };`,
    );
    await stubDocument({ locale: "de", assets: { [KEY]: fileName } });
    const { loadClientCatalog } = await loadModule();

    await expect(loadClientCatalog(MARKER)).resolves.toEqual({ a: "Hallo" });
    expect(globalThis.__pmds_test_asset_attempts).toBe(2);
  });

  it("names the module and URL when the asset fails twice", async () => {
    const fileName = "missing.de.js";
    const expectedUrl = `${APP_ORIGIN}/_next/static/palamedes/${fileName}`;
    await stubDocument({ locale: "de", assets: { [KEY]: fileName } });
    const { loadClientCatalog } = await loadModule();

    const failure = await loadClientCatalog(MARKER).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      `Palamedes could not load the "de" messages of src/components/Greeting.tsx from ${expectedUrl}, also after one retry. Check that .next/static/palamedes is served from the same build as the client chunks.`,
    );
    expect((failure as Error).cause).toBeInstanceOf(Error);
  });

  it("does not retry a module that has no asset in the map", async () => {
    await stubDocument({ locale: "de", assets: {} });
    const { loadClientCatalog } = await loadModule();

    await expect(loadClientCatalog(MARKER)).rejects.toThrow(
      `The Palamedes client catalog map has no "de" asset for src/components/Greeting.tsx (module key ${KEY}).`,
    );
  });

  it("falls back to the module key for a marker without a readable payload", async () => {
    await stubDocument({ locale: "de", assets: {} });
    const { loadClientCatalog } = await loadModule();

    await expect(loadClientCatalog(`pmds-next:${KEY}:%`)).rejects.toThrow(
      `has no "de" asset for ${KEY} (module key ${KEY})`,
    );
  });

  it("rejects a map rendered for another locale", async () => {
    await stubDocument({ locale: "en", assets: {} }, "de");
    const { loadClientCatalog } = await loadModule();

    await expect(loadClientCatalog(MARKER)).rejects.toThrow(
      'The Palamedes client catalog map is for locale "en", but the document locale is "de".',
    );
  });

  it("rejects an asset that exports no messages without retrying", async () => {
    const fileName = await writeAsset(
      "empty.de.js",
      "globalThis.__pmds_test_asset_attempts += 1; export const other = 1;",
    );
    const expectedUrl = `${APP_ORIGIN}/_next/static/palamedes/${fileName}`;
    await stubDocument({ locale: "de", assets: { [KEY]: fileName } });
    const { loadClientCatalog } = await loadModule();

    await expect(loadClientCatalog(MARKER)).rejects.toThrow(
      `${expectedUrl} is not a Palamedes client catalog asset: it exports no messages.`,
    );
    expect(globalThis.__pmds_test_asset_attempts).toBe(1);
  });

  it("names the map URL when the catalog map fails twice", async () => {
    const href = `${APP_ORIGIN}/_next/static/palamedes/catalogs.missing.mjs`;
    stubDocumentLink(href);
    const { loadClientCatalog } = await loadModule();

    await expect(loadClientCatalog(MARKER)).rejects.toThrow(
      `Palamedes could not load the client catalog map from ${href}, also after one retry.`,
    );
  });

  it("rejects DOM-clobbered elements, wrong rel values, and links outside document.head", async () => {
    const validHref = `${APP_ORIGIN}/_next/static/palamedes/catalogs.de.0123456789ab.js`;
    const body = { tagName: "BODY" };

    for (const options of [
      { element: { href: validHref, rel: "modulepreload", parentElement: { tagName: "HEAD" } } },
      { rel: "stylesheet" },
      { rel: "preload" },
      { parentElement: body },
      { head: null, parentElement: null },
    ]) {
      stubDocumentLink(validHref, "de", options);
      const { loadClientCatalog } = await loadModule();
      await expect(loadClientCatalog(MARKER)).rejects.toThrow(
        "The document has no Palamedes client catalog map.",
      );
    }
  });

  it("rejects cross-origin, non-http, and out-of-prefix map URLs", async () => {
    const invalidHrefs = [
      "https://evil.example/_next/static/palamedes/catalogs.de.0123456789ab.js",
      "data:text/javascript,export default {}",
      "file:///tmp/catalogs.de.0123456789ab.js",
      "blob:https://app.example/catalogs.de.0123456789ab.js",
      `${APP_ORIGIN}/other-app/_next/static/palamedes/catalogs.de.0123456789ab.js`,
      `${APP_ORIGIN}/uploads/catalogs.de.0123456789ab.js`,
      `${APP_ORIGIN}/_next/static/palamedes/not-a-catalog.js`,
      `${APP_ORIGIN}/_next/static/palamedes/sub/catalogs.de.0123456789ab.js`,
      `${APP_ORIGIN}/_next/static/palamedes/../chunks/catalogs.de.0123456789ab.js`,
      "https://user:pass@app.example/_next/static/palamedes/catalogs.de.0123456789ab.js",
    ];

    for (const href of invalidHrefs) {
      stubDocumentLink(href);
      const { loadClientCatalog } = await loadModule();
      await expect(loadClientCatalog(MARKER)).rejects.toThrow(
        "The document has no Palamedes client catalog map.",
      );
    }

    // When a configured base is present, an unexpected origin or prefix is also rejected.
    vi.stubEnv("PALAMEDES_NEXT_CATALOG_BASE", "/shop/_next/static/palamedes/");
    stubDocumentLink(`${APP_ORIGIN}/other/_next/static/palamedes/catalogs.de.0123456789ab.js`);
    const { loadClientCatalog: loadWithConfiguredBase } = await loadModule();
    await expect(loadWithConfiguredBase(MARKER)).rejects.toThrow(
      "The document has no Palamedes client catalog map.",
    );
  });

  it("rejects unsafe asset filenames in map.assets", async () => {
    const unsafeFileNames = [
      "../chunks/evil.js",
      "sub/evil.js",
      "/evil.js",
      "//evil.example/evil.js",
      "sub\\evil.js",
      "https://evil.example/evil.js",
      "data:text/javascript,export const messages={}",
      "..",
      ".",
      "a..b.js",
      "",
      "chunk.de.js?evil=1",
      "chunk.de.js#evil",
    ];

    for (const fileName of unsafeFileNames) {
      await stubDocument({ locale: "de", assets: {} }, "de", {
        rawAssets: { [fileName]: KEY },
      });
      const { loadClientCatalog } = await loadModule();
      await expect(loadClientCatalog(MARKER)).rejects.toThrow(/invalid asset entry/u);
    }
  });
});
