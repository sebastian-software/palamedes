import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Transform } from "node:stream";
import { runInNewContext } from "node:vm";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createViteCatalogDelivery } from "./delivery";

const fixtureDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    fixtureDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("Vite catalog delivery", () => {
  it("loads an active-locale binding from Vite's manifest", async () => {
    const clientDirectory = await createFixture();
    const delivery = createViteCatalogDelivery({ clientDirectory });

    expect(delivery.getLocaleBinding("de")).toStrictEqual({
      locale: "de",
      importMapJson: '{"imports":{"#pmds/route":"/app/assets/route.de.js"}}',
      imports: { "#pmds/route": "/app/assets/route.de.js" },
      chunkImports: { "assets/route.js": ["#pmds/route"] },
    });
  });

  it("reloads catalog-only manifest changes without process restart", async () => {
    const clientDirectory = await createFixture();
    const delivery = createViteCatalogDelivery({ clientDirectory });

    expect(delivery.getLocaleBinding("de")?.imports["#pmds/route"]).toBe("/app/assets/route.de.js");
    await writeFile(
      path.join(clientDirectory, "palamedes-split-manifest.json"),
      JSON.stringify({
        locales: ["en", "de"],
        importMaps: { en: "palamedes-importmap.en.json", de: "palamedes-importmap.de-new.json" },
        chunkImports: { "assets/route.js": ["#pmds/route"] },
      }),
    );
    await writeFile(
      path.join(clientDirectory, "palamedes-importmap.de-new.json"),
      JSON.stringify({ imports: { "#pmds/route": "/app/assets/route.de-new.js" } }),
    );

    expect(delivery.getLocaleBinding("de")?.imports["#pmds/route"]).toBe(
      "/app/assets/route.de-new.js",
    );
  });

  it("ignores stale production assets while the development server owns dependencies", async () => {
    const clientDirectory = await createFixture();
    const delivery = createViteCatalogDelivery({ clientDirectory, development: true });
    expect(delivery.getLocaleBinding("de")).toBeNull();
  });

  it("fails closed for missing production assets and permits a pre-build dev server", async () => {
    const clientDirectory = await mkdtemp(path.join(os.tmpdir(), "palamedes-vite-delivery-empty-"));
    fixtureDirectories.push(clientDirectory);

    expect(() => createViteCatalogDelivery({ clientDirectory }).getLocaleBinding("en")).toThrow(
      /client manifest is required/,
    );
    expect(
      createViteCatalogDelivery({ clientDirectory, development: true }).getLocaleBinding("en"),
    ).toBeNull();
  });

  it.each([
    ["importMaps", { locales: ["en"], importMaps: null, chunkImports: {} }],
    ["chunkImports", { locales: ["en"], importMaps: {}, chunkImports: null }],
    ["importMaps array", { locales: ["en"], importMaps: [], chunkImports: {} }],
    ["chunkImports array", { locales: ["en"], importMaps: {}, chunkImports: [] }],
  ])("rejects a malformed %s manifest field", async (_field, value) => {
    const clientDirectory = await createFixture();
    await writeFile(
      path.join(clientDirectory, "palamedes-split-manifest.json"),
      JSON.stringify(value),
    );

    expect(() => createViteCatalogDelivery({ clientDirectory }).getLocaleBinding("en")).toThrow(
      /invalid (?:importMaps|chunkImports)/u,
    );
  });

  it("injects a nonce-bearing import map and active chunk preloads for non-root bases", async () => {
    const clientDirectory = await createFixture();
    const delivery = createViteCatalogDelivery({ clientDirectory });
    const binding = delivery.getLocaleBinding("de");
    const transform = delivery.createDocumentTransform(binding, { nonce: "nonce&value" });
    const chunks = await collect(
      transform,
      '<html><head><link rel="modulepreload" href="https://cdn.example.test/app/assets/route.js"></head><body>app</body></html>',
    );

    expect(chunks).toContain(
      '<script type="importmap" nonce="nonce&amp;value">{"imports":{"#pmds/route":"/app/assets/route.de.js"}}</script>',
    );
    expect(chunks).toContain('<link rel="modulepreload" href="/app/assets/route.de.js">');
    expect(chunks.indexOf("importmap")).toBeLessThan(chunks.indexOf("</head>"));
    expect(chunks.indexOf("importmap")).toBeLessThan(chunks.indexOf('rel="modulepreload"'));
  });

  it.each([
    ['<html lang="en" data-time-zone="UTC">', '<html lang="de" data-time-zone="UTC">'],
    ["<html lang='en'>", '<html lang="de">'],
    ['<html data-lang="x" xml:lang="en">', '<html lang="de" data-lang="x" xml:lang="en">'],
    ["<html>", '<html lang="de">'],
  ])("writes the bound locale to %s", async (htmlTag, expected) => {
    const delivery = createViteCatalogDelivery({ clientDirectory: await createFixture() });
    const transform = delivery.createDocumentTransform(delivery.getLocaleBinding("de"), {
      lang: "de",
    });
    const html = await collect(
      transform,
      `<!DOCTYPE html>${htmlTag}<head></head><body lang="en">app</body></html>`,
    );
    expect(html.startsWith(`<!DOCTYPE html>${expected}<head><script type="importmap">`)).toBe(true);
    expect(html).toContain('<body lang="en">');
  });

  it("sets further <html> attributes and rejects invalid names", async () => {
    const delivery = createViteCatalogDelivery({ clientDirectory: await createFixture() });
    const binding = delivery.getLocaleBinding("de");
    const html = await collect(
      delivery.createDocumentTransform(binding, {
        lang: "de",
        htmlAttributes: { "data-state": 'a"b', "data-palamedes-flag": "" },
      }),
      '<html lang="en" data-state="old"><head></head><body>app</body></html>',
    );
    expect(html).toContain('<html data-palamedes-flag="" lang="de" data-state="a&quot;b">');
    expect(() =>
      delivery.createDocumentTransform(binding, { htmlAttributes: { "on click": "x" } }),
    ).toThrow("Invalid <html> attribute name");
  });

  it("keeps the document language unless a locale is passed", async () => {
    const delivery = createViteCatalogDelivery({ clientDirectory: await createFixture() });
    const transform = delivery.createDocumentTransform(delivery.getLocaleBinding("de"));
    const html = await collect(transform, '<html lang="en"><head></head><body>app</body></html>');
    expect(html).toContain('<html lang="en">');
  });

  it("removes bare catalog preload hints before adding locale-bound assets", async () => {
    const delivery = createViteCatalogDelivery({ clientDirectory: await createFixture() });
    const binding = delivery.getLocaleBinding("de");
    const transform = delivery.createDocumentTransform(binding);
    const html = await collect(
      transform,
      '<html><head><link rel="modulepreload" href="/#pmds/route"><script type="module" src="/assets/route.js"></script></head><body>app</body></html>',
    );
    expect(html).not.toContain('href="/#pmds/route"');
    expect(html).toContain('href="/app/assets/route.de.js"');
  });

  it("observes catalog dependencies of a module entry without modulepreload hints", async () => {
    const clientDirectory = await createFixture();
    const delivery = createViteCatalogDelivery({ clientDirectory });
    const binding = delivery.getLocaleBinding("de");
    const transform = delivery.createDocumentTransform(binding);
    const html = await collect(
      transform,
      '<html><head><script type="module" src="/app/assets/route.js"></script></head><body>app</body></html>',
    );

    expect(html).toContain('Promise.all(["/app/assets/route.de.js"].map(url=>import(url)))');
    expect(html).toContain('<link rel="modulepreload" href="/app/assets/route.de.js">');
  });

  it("preserves UTF-8 across streamed chunk boundaries", async () => {
    const delivery = createViteCatalogDelivery({ clientDirectory: await createFixture() });
    const transform = delivery.createDocumentTransform(delivery.getLocaleBinding("de"));
    const chunks: Buffer[] = [];
    transform.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    const done = new Promise<void>((resolve, reject) => {
      transform.once("end", resolve);
      transform.once("error", reject);
    });
    const html = "<html><head><title>Grüße</title></head><body>España 日本</body></html>";
    for (const byte of Buffer.from(html)) transform.write(Buffer.from([byte]));
    transform.end();
    await done;
    const result = Buffer.concat(chunks).toString("utf8");
    expect(result).toContain("<title>Grüße</title>");
    expect(result).toContain("<body>España 日本</body>");
    expect(result).not.toContain("�");
  });

  it("installs a catalog-independent development failure probe without a manifest", async () => {
    const clientDirectory = await mkdtemp(path.join(os.tmpdir(), "palamedes-vite-delivery-dev-"));
    fixtureDirectories.push(clientDirectory);
    const delivery = createViteCatalogDelivery({ clientDirectory, development: true });
    const transform = delivery.createDocumentTransform(delivery.getLocaleBinding("en"));
    const html = await collect(
      transform,
      '<html><head></head><body><script type="module" src="/entry.client.tsx"></script>dev</body></html>',
    );
    expect(html).toContain("showPalamedesDevCatalogError");
    expect(html).toContain("palamedes:catalogError");
  });

  it.each(["error", "unhandledrejection", "vite:preloadError"])(
    "leaves unrelated %s events to the host",
    async (type) => {
      const probe = await createDevelopmentProbe();
      const event = new Event(type, { cancelable: true });
      Object.assign(event, { error: new Error("Application hydration failed") });
      probe.target.dispatchEvent(event);
      expect(probe.replaceChildren).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
      expect(probe.context.__reactRouterContext.isSpaMode).toBe(false);
    },
  );

  it("shows recovery UI once for an explicit catalog failure", async () => {
    const probe = await createDevelopmentProbe();
    probe.target.dispatchEvent(new Event("palamedes:catalogError"));
    probe.target.dispatchEvent(new Event("palamedes:catalogError"));
    expect(probe.replaceChildren).toHaveBeenCalledTimes(1);
    expect(probe.context.__reactRouterContext.isSpaMode).toBe(true);
    expect(probe.template.innerHTML).toContain("Reload the page");
  });

  it("defers catalog recovery until the document body exists", async () => {
    const probe = await createDevelopmentProbe();
    probe.context.document.body = null;
    probe.target.dispatchEvent(new Event("palamedes:catalogError"));
    expect(probe.replaceChildren).not.toHaveBeenCalled();
    probe.context.document.body = { replaceChildren: probe.replaceChildren };
    probe.documentTarget.dispatchEvent(new Event("DOMContentLoaded"));
    expect(probe.replaceChildren).toHaveBeenCalledTimes(1);
  });

  it("leaves a production document unchanged when no manifest binding exists", async () => {
    const clientDirectory = await mkdtemp(path.join(os.tmpdir(), "palamedes-vite-delivery-prod-"));
    fixtureDirectories.push(clientDirectory);
    const delivery = createViteCatalogDelivery({ clientDirectory });
    const transform = delivery.createDocumentTransform(null);
    await expect(collect(transform, "<html><head></head><body>prod</body></html>")).resolves.toBe(
      "<html><head></head><body>prod</body></html>",
    );
  });
});

async function createFixture(): Promise<string> {
  const clientDirectory = await mkdtemp(path.join(os.tmpdir(), "palamedes-vite-delivery-client-"));
  fixtureDirectories.push(clientDirectory);
  await writeFile(
    path.join(clientDirectory, "palamedes-split-manifest.json"),
    JSON.stringify({
      locales: ["en", "de"],
      importMaps: { en: "palamedes-importmap.en.json", de: "palamedes-importmap.de.json" },
      chunkImports: { "assets/route.js": ["#pmds/route"] },
    }),
  );
  await writeFile(
    path.join(clientDirectory, "palamedes-importmap.en.json"),
    JSON.stringify({ imports: { "#pmds/route": "/app/assets/route.en.js" } }),
  );
  await writeFile(
    path.join(clientDirectory, "palamedes-importmap.de.json"),
    '{"imports":{"#pmds/route":"/app/assets/route.de.js"}}',
  );
  await mkdir(path.join(clientDirectory, "assets"));
  return clientDirectory;
}

async function collect(stream: Transform, value: string): Promise<string> {
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)));
  const done = new Promise<void>((resolve, reject) => {
    stream.once("end", resolve);
    stream.once("error", reject);
  });
  stream.end(value);
  await done;
  return Buffer.concat(chunks).toString("utf8");
}

async function createDevelopmentProbe() {
  const clientDirectory = await mkdtemp(path.join(os.tmpdir(), "palamedes-vite-delivery-probe-"));
  fixtureDirectories.push(clientDirectory);
  const delivery = createViteCatalogDelivery({ clientDirectory, development: true });
  const html = await collect(
    delivery.createDocumentTransform(null),
    "<html><head></head><body>app</body></html>",
  );
  const script = html.match(/<script>([\s\S]*?)<\/script>/u)?.[1];
  if (!script) throw new Error("Missing development catalog probe");
  const target = new EventTarget();
  const documentTarget = new EventTarget();
  const replaceChildren = vi.fn();
  const template = { innerHTML: "", content: { cloneNode: () => ({}) } };
  const context = {
    __reactRouterContext: { isSpaMode: false },
    addEventListener: target.addEventListener.bind(target),
    document: {
      body: { replaceChildren } as { replaceChildren: typeof replaceChildren } | null,
      createElement: () => template,
      addEventListener: documentTarget.addEventListener.bind(documentTarget),
    },
  };
  runInNewContext(script, context);
  return { context, target, documentTarget, replaceChildren, template };
}
