import { Transform } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { createWakuCatalogDeliveryMiddleware } from "./server";

vi.mock("@palamedes/vite-plugin/delivery", () => ({
  createViteCatalogDelivery: () => ({
    getLocaleBinding: () => ({ locale: "en" }),
    createDocumentTransform: () =>
      new Transform({
        transform(chunk, _encoding, callback) {
          this.push(chunk);
          callback();
        },
      }),
  }),
}));

async function transformHtml(input: string, splitAt: number[], nonce?: string): Promise<string> {
  const bytes = Buffer.from(input, "utf8");
  const chunks: Uint8Array[] = [];
  let offset = 0;
  for (const end of [...splitAt, bytes.length]) {
    chunks.push(bytes.subarray(offset, end));
    offset = end;
  }
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  const context = {
    req: { raw: new Request("https://example.test/") },
    res: new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } }),
  } as Parameters<ReturnType<typeof createWakuCatalogDeliveryMiddleware>>[0];

  const middleware = createWakuCatalogDeliveryMiddleware({
    clientDirectory: "dist/public",
    resolveLocale: () => "en",
    ...(nonce ? { nonce } : {}),
  });
  await middleware(context, async () => undefined);
  return context.res.text();
}

describe("Waku catalog document delivery", () => {
  it("rewrites a split UTF-8 Waku bootstrap without dropping bytes or the gate", async () => {
    const input = `prefix 😀 <script id="_R_">window.addEventListener('vite:preloadError', function (e) {
var key = 'waku:preload-error-build-id';
var canRetry = false;
if (!canRetry) {
return;
}
globalThis.__WAKU_INITIAL_RSC__ = true;
globalThis[Symbol.for("palamedes.document-catalogs-ready-promise")].then(() => import("/assets/index-abc.js")).catch((err) => {
throw err;
});</script> suffix`;
    const splitPattern = input.indexOf('import("/assets/index-abc.js")') + 10;
    const splitEmoji = Buffer.byteLength("prefix ", "utf8") + 1;
    const output = await transformHtml(input, [splitEmoji, splitPattern, splitPattern + 3]);

    expect(output).toContain("prefix 😀");
    expect(output).toMatch(
      /if \(globalThis\[Symbol\.for\("palamedes\.document-catalogs-ready"\)\] \|\| !globalThis\[Symbol\.for\("palamedes\.document-catalogs-ready-promise"\)\]/u,
    );
    expect(output).toContain("suffix");
  });

  it("keeps development Waku startup usable when the readiness promise is absent", async () => {
    const input = 'import("/assets/index-dev.js").catch((err) => { throw err; });';
    const middleware = createWakuCatalogDeliveryMiddleware({
      clientDirectory: "dist/public",
      development: true,
      resolveLocale: () => "en",
    });
    const bytes = new TextEncoder().encode(input);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    const context = {
      req: { raw: new Request("https://example.test/") },
      res: new Response(body, { headers: { "content-type": "text/html" } }),
    } as Parameters<ReturnType<typeof createWakuCatalogDeliveryMiddleware>>[0];
    await middleware(context, async () => undefined);

    const output = await context.res.text();
    expect(output).toContain("globalThis[Symbol.for");
    expect(output).toContain("? globalThis[Symbol.for");
  });

  it("adds the host nonce to Waku inline scripts while preserving existing nonces", async () => {
    const input =
      '<script>const source = "<script>"; const emoji = "😀";</script><script nonce="existing">window.ok = true;</script>';
    const output = await transformHtml(
      input,
      [Buffer.byteLength('<script>const emoji = "', "utf8") + 1],
      "nonce<&",
    );

    expect(output).toContain('<script nonce="nonce&lt;&amp;">');
    expect(output).toContain('<script nonce="existing">');
    expect(output).toContain('const source = "<script>"; const emoji = "😀"');
  });
});
