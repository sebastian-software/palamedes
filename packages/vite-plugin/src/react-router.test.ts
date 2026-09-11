import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Transform } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { createReactRouterCatalogDelivery } from "./react-router";

const fixtureDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    fixtureDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("React Router catalog delivery", () => {
  it("loads an active-locale binding from Vite's manifest", async () => {
    const clientDirectory = await createFixture();
    const delivery = createReactRouterCatalogDelivery({ clientDirectory });

    expect(delivery.getLocaleBinding("de")).toStrictEqual({
      locale: "de",
      importMapJson: '{"imports":{"#pmds/route":"/app/assets/route.de.js"}}',
      imports: { "#pmds/route": "/app/assets/route.de.js" },
      chunkImports: { "assets/route.js": ["#pmds/route"] },
    });
  });

  it("reloads catalog-only manifest changes without process restart", async () => {
    const clientDirectory = await createFixture();
    const delivery = createReactRouterCatalogDelivery({ clientDirectory });

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
    const delivery = createReactRouterCatalogDelivery({ clientDirectory, development: true });
    expect(delivery.getLocaleBinding("de")).toBeNull();
  });

  it("fails closed for missing production assets and permits a pre-build dev server", async () => {
    const clientDirectory = await mkdtemp(path.join(os.tmpdir(), "palamedes-react-router-empty-"));
    fixtureDirectories.push(clientDirectory);

    expect(() =>
      createReactRouterCatalogDelivery({ clientDirectory }).getLocaleBinding("en"),
    ).toThrow(/client manifest is required/);
    expect(
      createReactRouterCatalogDelivery({ clientDirectory, development: true }).getLocaleBinding(
        "en",
      ),
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

    expect(() =>
      createReactRouterCatalogDelivery({ clientDirectory }).getLocaleBinding("en"),
    ).toThrow(/invalid (?:importMaps|chunkImports)/u);
  });

  it("injects a nonce-bearing import map and active chunk preloads for non-root bases", async () => {
    const clientDirectory = await createFixture();
    const delivery = createReactRouterCatalogDelivery({ clientDirectory });
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

  it("observes catalog dependencies of a module entry without modulepreload hints", async () => {
    const clientDirectory = await createFixture();
    const delivery = createReactRouterCatalogDelivery({ clientDirectory });
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
    const delivery = createReactRouterCatalogDelivery({ clientDirectory: await createFixture() });
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

  it("does not invent a catalog boundary when development has no manifest", async () => {
    const clientDirectory = await mkdtemp(path.join(os.tmpdir(), "palamedes-react-router-dev-"));
    fixtureDirectories.push(clientDirectory);
    const delivery = createReactRouterCatalogDelivery({ clientDirectory, development: true });
    const transform = delivery.createDocumentTransform(delivery.getLocaleBinding("en"));
    await expect(collect(transform, "<html><head></head><body>dev</body></html>")).resolves.toBe(
      "<html><head></head><body>dev</body></html>",
    );
  });
});

async function createFixture(): Promise<string> {
  const clientDirectory = await mkdtemp(path.join(os.tmpdir(), "palamedes-react-router-client-"));
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
