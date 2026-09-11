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
  await middleware(context, async () => {});
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

  it("rewrites the retry guard even when it streams long before the entry", async () => {
    const input = `<script id="_R_">prefix 😀 if (!canRetry) {\nreturn;\n} ${" ".repeat(1000)} import("/assets/index-abc.js") suffix</script>`;
    const bytes = Buffer.byteLength(input);
    const output = await transformHtml(
      input,
      Array.from({ length: bytes - 1 }, (_, index) => index + 1),
    );
    expect(output).not.toContain("if (!canRetry)");
    expect(output).toContain('if (globalThis[Symbol.for("palamedes.document-catalogs-ready")]');
    expect(output).toContain('.then(() => import("/assets/index-abc.js"))');
    expect(output).toContain("prefix 😀");
  });

  it("does not authorize arbitrary scripts with a host nonce", async () => {
    const input = `<script data-nonce="untrusted" data-label="${"x".repeat(1000)}">console.log("你好")</script>`;
    const bytes = Buffer.byteLength(input);
    const output = await transformHtml(
      input,
      Array.from({ length: bytes - 1 }, (_, index) => index + 1),
      "trusted",
    );
    expect(output).toBe(input);
    expect(output).toContain(`data-label="${"x".repeat(1000)}"`);
    expect(output).toContain('console.log("你好")');
  });

  it("keeps development Waku startup usable when the readiness promise is absent", async () => {
    const input =
      '<script id="_R_">import("/assets/index-dev.js").catch((err) => { throw err; });</script>';
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
    await middleware(context, async () => {});

    const output = await context.res.text();
    expect(output).toContain("globalThis[Symbol.for");
    expect(output).toContain("? globalThis[Symbol.for");
  });

  it("preserves ordinary inline scripts and existing framework nonces", async () => {
    const input =
      '<script>const source = "<script>"; const emoji = "😀";</script><script nonce="existing">window.ok = true;</script>';
    const output = await transformHtml(
      input,
      [Buffer.byteLength('<script>const emoji = "', "utf8") + 1],
      "nonce<&",
    );

    expect(output).toBe(input);
    expect(output).toContain('<script nonce="existing">');
    expect(output).toContain('const source = "<script>"; const emoji = "😀"');
  });
  it.each(["/app/assets/index-abc.js", "https://cdn.example.test/app/assets/index-abc.js"])(
    "gates a framework entry under the configured asset base: %s",
    async (source) => {
      const input = `<script id="_R_">import(${JSON.stringify(source)})</script>`;
      const bytes = Buffer.byteLength(input);
      const output = await transformHtml(
        input,
        Array.from({ length: bytes - 1 }, (_, index) => index + 1),
      );
      expect(output).toContain(`.then(() => import(${JSON.stringify(source)}))`);
    },
  );
  it("does not add a nonce to external scripts or application inline code", async () => {
    const input =
      '<script src="https://untrusted.example/script.js"></script><script>window.untrusted=true</script>';
    expect(await transformHtml(input, [12, 65], "trusted")).toBe(input);
  });
  it("preserves application scripts and rendered text resembling the framework bootstrap", async () => {
    const input = `<p>import("/assets/index-content.js")</p><script data-id="_R_">if (!canRetry) { return; } import("/assets/index-app.js")</script>`;
    const bytes = Buffer.byteLength(input);
    expect(
      await transformHtml(
        input,
        Array.from({ length: bytes - 1 }, (_, index) => index + 1),
      ),
    ).toBe(input);
  });
});
