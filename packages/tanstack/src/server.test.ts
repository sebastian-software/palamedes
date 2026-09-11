import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { defineCompiledCatalog } from "@palamedes/core";

const loadServerCatalog = vi.fn(async (locale: string) =>
  defineCompiledCatalog({ greeting: locale === "de" ? "Hallo" : "Hello" }),
);

vi.mock(
  "virtual:palamedes/server-catalogs",
  () => ({ loadServerCatalog }),
  // Vitest supports the virtual-module option at runtime; its published
  // overload omits the third argument in the current type definitions.
  // @ts-expect-error virtual module option is supported by the test runner.
  { virtual: true },
);

describe("TanStack server catalog adapter", () => {
  afterEach(() => loadServerCatalog.mockClear());

  it("loads only the selected generated catalog into a fresh instance", async () => {
    const { createTanStackServerI18n } = await import("./server");

    const i18n = await createTanStackServerI18n({
      locale: "de",
      timeZone: "Europe/Berlin",
    });

    expect(loadServerCatalog).toHaveBeenCalledWith("de");
    expect(i18n.locale).toBe("de");
    expect(i18n.timeZone).toBe("Europe/Berlin");
    expect(i18n._("greeting")).toBe("Hallo");
  });

  it("keeps concurrent locale and time-zone state on separate instances", async () => {
    const { createTanStackServerI18n } = await import("./server");
    const [berlin, tokyo] = await Promise.all([
      createTanStackServerI18n({ locale: "de", timeZone: "Europe/Berlin" }),
      createTanStackServerI18n({ locale: "en", timeZone: "Asia/Tokyo" }),
    ]);

    expect(berlin).not.toBe(tokyo);
    expect(berlin.locale).toBe("de");
    expect(berlin.timeZone).toBe("Europe/Berlin");
    expect(berlin._("greeting")).toBe("Hallo");
    expect(tokyo.locale).toBe("en");
    expect(tokyo.timeZone).toBe("Asia/Tokyo");
    expect(tokyo._("greeting")).toBe("Hello");
  });

  it("propagates generated catalog failures without creating partial request state", async () => {
    const { createTanStackServerI18n } = await import("./server");
    const failure = new Error("catalog fragment unavailable");
    loadServerCatalog.mockRejectedValueOnce(failure);

    await expect(createTanStackServerI18n({ locale: "en" })).rejects.toBe(failure);
  });

  it("binds the active production catalog before TanStack route modules execute", async () => {
    const clientDirectory = mkdtempSync(path.join(os.tmpdir(), "palamedes-tanstack-delivery-"));
    try {
      writeFileSync(
        path.join(clientDirectory, "palamedes-split-manifest.json"),
        JSON.stringify({
          locales: ["de"],
          importMaps: { de: "assets/palamedes-importmap.de.json" },
          chunkImports: {},
        }),
      );
      mkdirSync(path.join(clientDirectory, "assets"), { recursive: true });
      writeFileSync(
        path.join(clientDirectory, "assets/palamedes-importmap.de.json"),
        JSON.stringify({ imports: { "#pmds/greeting": "/assets/greeting.js" } }),
      );

      const { createTanStackCatalogResponseDelivery } = await import("./server");
      const deliver = createTanStackCatalogResponseDelivery({
        clientDirectory,
        nonce: "request-nonce",
      });
      const response = await deliver(
        new Response(
          '<html><head></head><body><script>window.__frameworkReady=true</script><script type="module" async src="/assets/index-abc.js"></script></body></html>',
          {
            headers: {
              "content-type": "text/html; charset=utf-8",
              "content-length": "1",
            },
          },
        ),
        "de",
        new Request("https://example.test/de"),
      );

      expect(response).toBeInstanceOf(Response);
      const html = await (response as Response).text();
      expect(html).toContain('<script type="importmap" nonce="request-nonce">');
      expect(html).toContain('<script nonce="request-nonce">window.__frameworkReady=true</script>');
      expect(html).toMatch(
        /<script nonce="request-nonce" type="module" async>globalThis\[Symbol\.for\("palamedes\.document-catalogs-ready-promise"\)\]\.then\(\(\) => import\("\/assets\/index-abc\.js"\)\)\.catch\(\(error\) => \{ if \(globalThis\[Symbol\.for\("palamedes\.document-catalogs-ready"\)\] \|\| !globalThis\[Symbol\.for\("palamedes\.document-catalogs-ready-promise"\)\]\) throw error; \}\);<\/script>/u,
      );
      expect(html).not.toContain('src="/assets/index-abc.js"');
      expect(html).toContain("palamedes.document-catalogs-ready-promise");
      expect((response as Response).headers.get("content-length")).toBeNull();
    } finally {
      rmSync(clientDirectory, { recursive: true, force: true });
    }
  });

  it("keeps UTF-8 and long framework script tags intact across byte-sized chunks", async () => {
    const clientDirectory = mkdtempSync(path.join(os.tmpdir(), "palamedes-tanstack-stream-"));
    try {
      writeFileSync(
        path.join(clientDirectory, "palamedes-split-manifest.json"),
        JSON.stringify({
          locales: ["en"],
          importMaps: { en: "assets/palamedes-importmap.en.json" },
          chunkImports: {},
        }),
      );
      mkdirSync(path.join(clientDirectory, "assets"), { recursive: true });
      writeFileSync(
        path.join(clientDirectory, "assets/palamedes-importmap.en.json"),
        JSON.stringify({ imports: { "#pmds/greeting": "/assets/greeting.js" } }),
      );

      const html = `<html><head></head><body><script data-long="${"x".repeat(256)}">const text="café 😀";</script><script data-nonce="framework-token">const nested="<script data-nonce='inside-text'>";</script><script nonce = "existing-token">window.existing=true;</script><script data-src="keep-${"😀".repeat(40)}" data-long="${"x".repeat(1200)}" type="module" async src="/assets/index-long.js"></script></body></html>`;
      const bytes = new TextEncoder().encode(html);
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
          controller.close();
        },
      });
      const { createTanStackCatalogResponseDelivery } = await import("./server");
      const deliver = createTanStackCatalogResponseDelivery({
        clientDirectory,
        nonce: "byte-stream-nonce",
      });
      const response = (await deliver(
        new Response(stream, { headers: { "content-type": "text/html" } }),
        "en",
        new Request("https://example.test/"),
      )) as Response;

      const rendered = await response.text();
      expect(rendered).toContain(
        `<script nonce="byte-stream-nonce" data-long="${"x".repeat(256)}">const text="café 😀";</script>`,
      );
      expect(rendered).toContain(
        `<script nonce="byte-stream-nonce" data-nonce="framework-token">const nested="<script data-nonce='inside-text'>";</script>`,
      );
      expect(rendered).toContain(`<script nonce = "existing-token">window.existing=true;</script>`);
      expect(rendered).toContain(
        `<script nonce="byte-stream-nonce" data-src="keep-${"😀".repeat(40)}" data-long="${"x".repeat(1200)}" type="module" async>globalThis[Symbol.for("palamedes.document-catalogs-ready-promise")].then(() => import("/assets/index-long.js")).catch((error) => { if (globalThis[Symbol.for("palamedes.document-catalogs-ready")] || !globalThis[Symbol.for("palamedes.document-catalogs-ready-promise")]) throw error; });</script>`,
      );
    } finally {
      rmSync(clientDirectory, { recursive: true, force: true });
    }
  });
});
