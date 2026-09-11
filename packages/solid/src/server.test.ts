import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createSolidCatalogDeliveryMiddleware } from "./server";

function fixtureDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "palamedes-solid-delivery-"));
  writeFileSync(
    path.join(directory, "palamedes-split-manifest.json"),
    JSON.stringify({
      locales: ["en"],
      importMaps: { en: "palamedes-importmap.en.json" },
      chunkImports: { "assets/entry.js": ["#pmds/catalog"] },
    }),
  );
  writeFileSync(
    path.join(directory, "palamedes-importmap.en.json"),
    JSON.stringify({ imports: { "#pmds/catalog": "/assets/catalog.en.js" } }),
  );
  return directory;
}

async function transformDocument(html: string, nonce?: string): Promise<string> {
  const middleware = createSolidCatalogDeliveryMiddleware({
    clientDirectory: fixtureDirectory(),
    nonce,
    resolveLocale: () => "en",
  });
  const response = await middleware(
    new Request("https://example.test/"),
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (const chunk of html.match(/.{1,3}/gu) ?? []) {
              controller.enqueue(new TextEncoder().encode(chunk));
            }
            controller.close();
          },
        }),
        { headers: { "content-type": "text/html; charset=utf-8", "content-length": "999" } },
      ),
  );
  return response.text();
}

describe("createSolidCatalogDeliveryMiddleware", () => {
  it("injects active-locale delivery before the deferred Solid entry", async () => {
    const html =
      '<!doctype html><html><head><script>const greeting = "Grüße 😀";</script><script type="module" src="/assets/entry.js"></script></head><body></body></html>';
    const output = await transformDocument(html, "solid-test");

    expect(output).toContain('type="importmap" nonce="solid-test"');
    expect(output).toContain('globalThis[Symbol.for("palamedes.document-catalogs-ready-promise")]');
    expect(output).toContain('import("/assets/entry.js")');
    expect(output).toContain('<script nonce="solid-test">const greeting = "Grüße 😀";</script>');
    expect(output).toContain('<script type="module" nonce="solid-test">');
    expect(output).not.toContain('src="/assets/entry.js"');
  });

  it("preserves content length semantics after streamed HTML mutation", async () => {
    const output = await transformDocument(
      '<html><head></head><body><script type="module" src="/assets/entry.js"></script></body></html>',
    );

    expect(output).toContain('import("/assets/entry.js")');
    expect(output).not.toContain('src="/assets/entry.js"');
  });

  it("holds long script tags until their closing token is complete", async () => {
    const attributes = "x".repeat(640);
    const output = await transformDocument(
      `<html><head><script data-padding="${attributes}">const ready = "😀";</script><script type="module" src="/assets/entry.js"></script></head><body></body></html>`,
    );

    expect(output).toContain(attributes);
    expect(output).toContain('const ready = "😀";');
    expect(output).toContain('import("/assets/entry.js")');
    expect(output).not.toContain('src="/assets/entry.js"');
  });
});
