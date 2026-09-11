import { StringDecoder } from "node:string_decoder";
import { Transform, type TransformCallback } from "node:stream";
import { createViteCatalogDelivery } from "@palamedes/vite-plugin/delivery";

export type SolidCatalogDeliveryOptions = {
  /** Built Nitro/Vite client directory containing palamedes-split-manifest.json. */
  clientDirectory: string;
  /** Resolve the application-owned locale policy from the original request. */
  resolveLocale: (request: Request) => string;
  /** Allow running before a client build exists in development. */
  development?: boolean;
  /** Optional catalog-free host UI for initial fragment failures. */
  errorHtml?: string;
  /** CSP nonce for generated and Solid inline bootstrap scripts. */
  nonce?: string | ((request: Request) => string | undefined);
};

export type SolidFetchMiddleware = (
  request: Request,
  next: () => Promise<Response>,
) => Promise<Response>;

const CATALOG_READY_PROMISE = 'Symbol.for("palamedes.document-catalogs-ready-promise")';
const CATALOG_READY = 'Symbol.for("palamedes.document-catalogs-ready")';
const TAIL_SIZE = 512;
const SCRIPT_BLOCK_PATTERN = /<script\b[^>]*>[\s\S]*?<\/script>/iu;

/**
 * Connects Vite's active-locale import-map delivery to Solid's Fetch
 * middleware. The module entry is imported only after the initial catalog
 * readiness promise settles, so a failed catalog never mounts the app over
 * the host's catalog-free error document.
 */
export function createSolidCatalogDeliveryMiddleware(
  options: SolidCatalogDeliveryOptions,
): SolidFetchMiddleware {
  const delivery = createViteCatalogDelivery(options);

  return async (request, next) => {
    const response = await next();
    if (!response.body || !response.headers.get("content-type")?.startsWith("text/html")) {
      return response;
    }

    const binding = delivery.getLocaleBinding(options.resolveLocale(request));
    const nonce = typeof options.nonce === "function" ? options.nonce(request) : options.nonce;
    const body = response.body
      .pipeThrough(
        Transform.toWeb(
          delivery.createDocumentTransform(binding, {
            ...(options.errorHtml ? { errorHtml: options.errorHtml } : {}),
            ...(nonce ? { nonce } : {}),
          }),
        ) as unknown as TransformStream<Uint8Array>,
      )
      .pipeThrough(
        Transform.toWeb(
          createSolidBootstrapGateTransform({
            allowMissingPromise: options.development === true,
            nonce,
          }),
        ) as unknown as TransformStream<Uint8Array>,
      );
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return new Response(body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  };
}

function createSolidBootstrapGateTransform(options: {
  allowMissingPromise: boolean;
  nonce?: string;
}): Transform {
  const decoder = new StringDecoder("utf8");
  let tail = "";

  return new Transform({
    transform(chunk: unknown, _encoding: BufferEncoding, callback: TransformCallback) {
      tail += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
      flushSafePrefix(this, false);
      callback();
    },
    flush(callback: TransformCallback) {
      tail += decoder.end();
      flushSafePrefix(this, true);
      callback();
    },
  });

  function flushSafePrefix(stream: Transform, flush: boolean) {
    while (true) {
      const match = SCRIPT_BLOCK_PATTERN.exec(tail);
      if (match) {
        const end = match.index + match[0].length;
        if (!flush && end > tail.length - TAIL_SIZE) break;
        const script = match[0];
        const moduleSource = script.match(
          /\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']|\bsrc=["']([^"']+)["'][^>]*\btype=["']module["']/iu,
        );
        let replacement = script;
        if (moduleSource) {
          const source = JSON.stringify(moduleSource[1] ?? moduleSource[2]);
          const nonce = options.nonce ? ` nonce="${escapeAttribute(options.nonce)}"` : "";
          const importExpression = options.allowMissingPromise
            ? `(globalThis[${CATALOG_READY_PROMISE}] ? globalThis[${CATALOG_READY_PROMISE}].then(() => import(${source})) : import(${source}))`
            : `globalThis[${CATALOG_READY_PROMISE}].then(() => import(${source}))`;
          replacement = `<script type="module"${nonce}>${importExpression}.catch((error) => { if (globalThis[${CATALOG_READY}]) throw error; });</script>`;
        } else if (options.nonce && !/\bnonce=["']/iu.test(script)) {
          replacement = script.replace(
            /^<script\b/iu,
            `<script nonce="${escapeAttribute(options.nonce)}"`,
          );
        }
        stream.push(tail.slice(0, match.index) + replacement);
        tail = tail.slice(end);
        continue;
      }
      if (flush) {
        if (tail) stream.push(tail);
        tail = "";
      } else {
        const scriptStart = tail.lastIndexOf("<script");
        const safeEnd = tail.length - TAIL_SIZE;
        if (safeEnd <= 0) return;
        if (scriptStart >= safeEnd) {
          stream.push(tail.slice(0, scriptStart));
          tail = tail.slice(scriptStart);
        } else {
          stream.push(tail.slice(0, safeEnd));
          tail = tail.slice(safeEnd);
        }
      }
      return;
    }
  }
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}
