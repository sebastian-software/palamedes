import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createSolidCatalogDeliveryMiddleware } from "./server";

const SOLID_CLIENT_ENTRY = "/assets/virtual_solid-ssr-entry-client-abc123.js";

function fixtureDirectory(catalogUrl = "/assets/catalog.en.js"): string {
  const directory = mkdtempSync(path.join(tmpdir(), "palamedes-solid-delivery-"));
  writeFileSync(
    path.join(directory, "palamedes-split-manifest.json"),
    JSON.stringify({
      locales: ["en"],
      importMaps: { en: "palamedes-importmap.en.json" },
      chunkImports: { "assets/virtual_solid-ssr-entry-client-abc123.js": ["#pmds/catalog"] },
    }),
  );
  writeFileSync(
    path.join(directory, "palamedes-importmap.en.json"),
    JSON.stringify({ imports: { "#pmds/catalog": catalogUrl } }),
  );
  return directory;
}

async function transformDocument(
  html: string,
  nonce?: string,
  chunkSize = 3,
  development = false,
  catalogUrl = "/assets/catalog.en.js",
): Promise<string> {
  const middleware = createSolidCatalogDeliveryMiddleware({
    clientDirectory: fixtureDirectory(catalogUrl),
    development,
    nonce,
    resolveLocale: () => "en",
  });
  const response = await middleware(
    new Request("https://example.test/"),
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            const bytes = new TextEncoder().encode(html);
            for (let index = 0; index < bytes.length; index += chunkSize) {
              controller.enqueue(bytes.slice(index, index + chunkSize));
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
    const html = `<!doctype html><html><head><script>const greeting = "Grüße 😀";</script><script type="module" src="${SOLID_CLIENT_ENTRY}"></script></head><body></body></html>`;
    const output = await transformDocument(html, "solid-test");

    expect(output).toContain('type="importmap" nonce="solid-test"');
    expect(output).toContain('globalThis[Symbol.for("palamedes.document-catalogs-ready-promise")]');
    expect(output).toContain(`import("${SOLID_CLIENT_ENTRY}")`);
    expect(output).toContain('<script>const greeting = "Grüße 😀";</script>');
    expect(output).toContain('<script type="module" nonce="solid-test">');
    expect(output).not.toContain(`src="${SOLID_CLIENT_ENTRY}"`);
  });

  it("preserves content length semantics after streamed HTML mutation", async () => {
    const output = await transformDocument(
      `<html><head></head><body><script type="module" src="${SOLID_CLIENT_ENTRY}"></script></body></html>`,
    );

    expect(output).toContain(`import("${SOLID_CLIENT_ENTRY}")`);
    expect(output).not.toContain(`src="${SOLID_CLIENT_ENTRY}"`);
  });

  it("holds long script tags until their closing token is complete", async () => {
    const attributes = "x".repeat(640);
    const output = await transformDocument(
      `<html><head><script data-padding="${attributes}">const ready = "😀";</script><script type="module" src="${SOLID_CLIENT_ENTRY}"></script></head><body></body></html>`,
    );

    expect(output).toContain(attributes);
    expect(output).toContain('const ready = "😀";');
    expect(output).toContain(`import("${SOLID_CLIENT_ENTRY}")`);
    expect(output).not.toContain(`src="${SOLID_CLIENT_ENTRY}"`);
  });

  it("keeps long tags, Unicode boundaries, and the real nonce attribute intact", async () => {
    const attributes = "x".repeat(1200);
    const html = `<html lang="de"><head><script data-nonce="not-a-csp-nonce" nonce = "existing">${"x".repeat(800)}😀</script><script data-padding="${attributes}">const marker = "😀";</script><script type = "module" src = "${SOLID_CLIENT_ENTRY}"></script></head><body></body></html>`;
    const output = await transformDocument(html, "solid-test", 1);

    expect(output).toContain('<html lang="de">');
    expect(output).toContain('data-nonce="not-a-csp-nonce" nonce = "existing"');
    expect(output).toContain(attributes);
    expect(output).toContain("😀");
    expect(output).toContain(`import("${SOLID_CLIENT_ENTRY}")`);
    expect(output).not.toContain(`src = "${SOLID_CLIENT_ENTRY}"`);
    expect(output).not.toContain("�");
  });

  it("leaves foreign inline scripts and data-nonce markers untouched", async () => {
    const output = await transformDocument(
      '<html><head><script data-nonce="wrong">const first = 1;</script><script nonce = "right">const second = 2;</script></head></html>',
      "solid-test",
    );

    expect(output).toContain('<script data-nonce="wrong">const first = 1;</script>');
    expect(output).toContain('<script nonce = "right">const second = 2;</script>');
    expect(output).not.toContain('<script nonce="solid-test" data-nonce="wrong"');
  });

  it("does not infer trust from inline script content", async () => {
    const output = await transformDocument(
      "<html><head><script>/* window._$HY */ evil();</script><script>globalThis.foreign = true;</script></head></html>",
      "solid-test",
    );

    expect(output).toContain("<script>/* window._$HY */ evil();</script>");
    expect(output).toContain("<script>globalThis.foreign = true;</script>");
  });

  it("leaves foreign module and third-party scripts unchanged", async () => {
    const html =
      '<html><head><script type="module" src="/assets/application.js"></script><script data-type="module" data-src="/assets/virtual_solid-ssr-entry-client-abc123.js"></script><script data-title=\'src="/assets/entry-client-evil.js" type="module" nonce="fake"\'></script><script src="https://cdn.example.test/foreign.js"></script></head><body></body></html>';
    const output = await transformDocument(html, "solid-test");

    expect(output).toContain('<script type="module" src="/assets/application.js"></script>');
    expect(output).toContain(
      '<script data-type="module" data-src="/assets/virtual_solid-ssr-entry-client-abc123.js"></script>',
    );
    expect(output).toContain(
      '<script data-title=\'src="/assets/entry-client-evil.js" type="module" nonce="fake"\'></script>',
    );
    expect(output).toContain('<script src="https://cdn.example.test/foreign.js"></script>');
    expect(output).not.toContain('nonce="solid-test" src="/assets/application.js"');
  });

  it("rejects a trusted Solid entry with fetch security attributes", async () => {
    const html = `<html><head><script type="module" src="${SOLID_CLIENT_ENTRY}" integrity="sha256-test" crossorigin="anonymous" referrerpolicy="no-referrer"></script></head><body></body></html>`;

    await expect(transformDocument(html)).rejects.toThrow(
      /unsupported fetch attributes: integrity, crossorigin, referrerpolicy/iu,
    );
  });

  it("leaves foreign entries with fetch security attributes unchanged", async () => {
    const source = "/assets/application.js";
    const html = `<html><head><script type="module" src="${source}" integrity="sha256-test" crossorigin="anonymous" referrerpolicy="no-referrer"></script></head><body></body></html>`;
    const output = await transformDocument(html);

    expect(output).toContain(
      `<script type="module" src="${source}" integrity="sha256-test" crossorigin="anonymous" referrerpolicy="no-referrer"></script>`,
    );
  });

  it("recognizes uppercase Solid tags after boolean attributes", async () => {
    const html = `<html><head><SCRIPT ASYNC TYPE="module" SRC="${SOLID_CLIENT_ENTRY}"></SCRIPT></head><body></body></html>`;
    const output = await transformDocument(html);

    expect(output).toContain(`import("${SOLID_CLIENT_ENTRY}")`);
    expect(output).not.toContain(`SRC="${SOLID_CLIENT_ENTRY}"`);
  });

  it("rejects boolean crossorigin and ignores quoted data-attribute spoofs", async () => {
    const trustedHtml = `<html><head><SCRIPT ASYNC CROSSORIGIN TYPE="module" SRC="${SOLID_CLIENT_ENTRY}"></SCRIPT></head><body></body></html>`;
    await expect(transformDocument(trustedHtml)).rejects.toThrow(/crossorigin/iu);

    const foreignSource = "/assets/application.js";
    const foreignHtml = `<html><head><SCRIPT DATA-SPOOF='type="module" src="${SOLID_CLIENT_ENTRY}" crossorigin' TYPE="module" SRC="${foreignSource}"></SCRIPT></head><body></body></html>`;
    const output = await transformDocument(foreignHtml);

    expect(output).toContain(
      `<SCRIPT DATA-SPOOF='type="module" src="${SOLID_CLIENT_ENTRY}" crossorigin' TYPE="module" SRC="${foreignSource}"></SCRIPT>`,
    );
  });

  it("advances past a self-closing script marker", async () => {
    const html = `<html><head><script type="module" src="${SOLID_CLIENT_ENTRY}" /></script></head><body></body></html>`;
    const output = await transformDocument(html);

    expect(output).toContain(`import("${SOLID_CLIENT_ENTRY}")`);
  });

  it("gates the generated Solid entry beneath a custom Vite base", async () => {
    const html =
      '<html><head><script type="module" src="/custom/base/assets/virtual_solid-ssr-entry-client-abc123.js"></script></head><body></body></html>';
    const output = await transformDocument(html, "solid-test");

    expect(output).toContain(
      'import("/custom/base/assets/virtual_solid-ssr-entry-client-abc123.js")',
    );
    expect(output).not.toContain(
      'src="/custom/base/assets/virtual_solid-ssr-entry-client-abc123.js"',
    );
  });

  it("gates a generated Solid entry on a configured CDN base", async () => {
    const source = "https://cdn.example.test/app/assets/virtual_solid-ssr-entry-client-abc123.js";
    const output = await transformDocument(
      `<html><head><script type="module" src="${source}"></script></head><body></body></html>`,
      "solid-test",
      3,
      false,
      "https://cdn.example.test/app/assets/catalog.en.js",
    );

    expect(output).toContain(`import("${source}")`);
    expect(output).not.toContain(`src="${source}"`);
  });

  it("does not trust an unrelated CDN entry with the Solid filename", async () => {
    const source =
      "https://foreign.example.test/app/assets/virtual_solid-ssr-entry-client-abc123.js";
    const output = await transformDocument(
      `<html><head><script type="module" src="${source}"></script></head><body></body></html>`,
      "solid-test",
    );

    expect(output).toContain(`<script type="module" src="${source}"></script>`);
  });

  it("does not trust a foreign authored entry with a matching path", async () => {
    const source = "https://foreign.example.test/app/assets/entry-client-abc123.js";
    const output = await transformDocument(
      `<html><head><script type="module" src="${source}"></script></head><body></body></html>`,
      "solid-test",
    );

    expect(output).toContain(`<script type="module" src="${source}"></script>`);
    expect(output).not.toContain(`import("${source}")`);
  });

  it("gates a same-origin authored client entry", async () => {
    const source = "https://example.test/app/assets/entry-client-abc123.js";
    const output = await transformDocument(
      `<html><head><script type="module" src="${source}"></script></head><body></body></html>`,
      "solid-test",
    );

    expect(output).toContain(`import("${source}")`);
    expect(output).not.toContain(`src="${source}"`);
  });

  it("recognizes the development virtual Solid entry", async () => {
    const html =
      '<html><head><script type="module" src="/custom/base/@id/__x00__virtual:solid-ssr-entry-client.tsx"></script></head><body></body></html>';
    const output = await transformDocument(html, "solid-test", 3, true);

    expect(output).toContain(
      'import("/custom/base/@id/__x00__virtual:solid-ssr-entry-client.tsx")',
    );
  });

  it("preserves a nonce already attached to the trusted Solid entry", async () => {
    const output = await transformDocument(
      `<html><head><script type="module" nonce="existing" src="${SOLID_CLIENT_ENTRY}"></script></head></html>`,
    );

    expect(output).toContain('<script type="module" nonce="existing">');
    expect(output).toContain(`import("${SOLID_CLIENT_ENTRY}")`);
  });
});
