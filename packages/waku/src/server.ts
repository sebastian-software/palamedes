import { Transform } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import type { MiddlewareHandler } from "hono";
import { createViteCatalogDelivery } from "@palamedes/vite-plugin/delivery";

export type WakuCatalogDeliveryOptions = {
  /** Built Vite client directory containing palamedes-split-manifest.json. */
  clientDirectory: string;
  /** Resolve the application-owned locale policy from the original request. */
  resolveLocale: (request: Request) => string;
  /** Allow running before a client build exists in development. */
  development?: boolean;
  /** Optional trusted catalog-free host UI for failed delivery. */
  errorHtml?: string;
  /**
   * CSP nonce for the generated import map and failure probe. A function may
   * derive the nonce from the current request when it is request-scoped.
   */
  nonce?: string | ((request: Request) => string | undefined);
};

/**
 * Connects Vite's active-locale import-map delivery to Waku's HTML response.
 * Locale selection remains application-owned; this middleware only transforms
 * document responses after Waku has rendered them and leaves RSC/action
 * responses untouched.
 */
export function createWakuCatalogDeliveryMiddleware(
  options: WakuCatalogDeliveryOptions,
): MiddlewareHandler {
  const delivery = createViteCatalogDelivery(options);

  return async (context, next) => {
    await next();
    const response = context.res;
    if (!response.body || !response.headers.get("content-type")?.startsWith("text/html")) {
      return;
    }

    const binding = delivery.getLocaleBinding(options.resolveLocale(context.req.raw));
    const nonce =
      typeof options.nonce === "function" ? options.nonce(context.req.raw) : options.nonce;
    const body = response.body
      .pipeThrough(
        webTransform(
          delivery.createDocumentTransform(binding, {
            ...(options.errorHtml ? { errorHtml: options.errorHtml } : {}),
            ...(nonce ? { nonce } : {}),
          }),
        ),
      )
      .pipeThrough(
        webTransform(
          createWakuBootstrapGateTransform({ allowMissingPromise: options.development === true }),
        ),
      );
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    context.res = new Response(body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  };
}

// Node and DOM stream declarations differ across the supported TypeScript majors.
function webTransform(transform: Transform): ReadableWritablePair<Uint8Array, Uint8Array> {
  return Transform.toWeb(transform) as unknown as ReadableWritablePair<Uint8Array, Uint8Array>;
}

const CATALOG_READY_PROMISE = 'Symbol.for("palamedes.document-catalogs-ready-promise")';
const CATALOG_READY = 'Symbol.for("palamedes.document-catalogs-ready")';
const WAKU_ENTRY_PATTERN =
  /import\(((['"])(?:https?:\/\/[^"']+)?\/(?:[^"']*\/)?index-[^"']+\.js\2)\)/u;
const TAIL_SIZE = 192;

/**
 * Waku emits an inline entry bootstrap after the document head. Gate that
 * import on the exact same catalog-import promise used by the delivery probe.
 * This keeps Waku from mounting over the host error document when an initial
 * fragment fails, without timing delays or app-owned DOM handling.
 */
function createWakuBootstrapGateTransform(options: { allowMissingPromise: boolean }): Transform {
  const decoder = new StringDecoder("utf8");
  let tail = "";

  function gateWakuEntry(value: string) {
    const importExpression = options.allowMissingPromise
      ? `(globalThis[${CATALOG_READY_PROMISE}] ? globalThis[${CATALOG_READY_PROMISE}].then(() => import($1)) : import($1))`
      : `globalThis[${CATALOG_READY_PROMISE}].then(() => import($1))`;
    return value
      .replace(
        /if \(!canRetry\) \{\s*return;\s*\}/u,
        `if (globalThis[${CATALOG_READY}] || !globalThis[${CATALOG_READY_PROMISE}]) {\nreturn;\n}\ne.preventDefault();\nreturn;`,
      )
      .replace(WAKU_ENTRY_PATTERN, importExpression);
  }

  return new Transform({
    transform(chunk, _encoding, callback) {
      tail += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      flushSafePrefix(this, false);
      callback();
    },
    flush(callback) {
      tail += decoder.end();
      flushSafePrefix(this, true);
      callback();
    },
  });

  function flushSafePrefix(stream: Transform, flush: boolean) {
    let end = flush ? tail.length : Math.max(0, tail.length - TAIL_SIZE);
    // A complete replacement can straddle the retained suffix. Keep that
    // entire token, and never emit an untransformed retry guard before entry.
    const patterns = [WAKU_ENTRY_PATTERN, /if \(!canRetry\) \{\s*return;\s*\}/u];
    for (const pattern of patterns) {
      for (const match of tail.matchAll(new RegExp(pattern.source, "gu"))) {
        if (match.index < end && match.index + match[0].length > end) end = match.index;
      }
    }
    if (!flush) {
      for (const prefix of ["import(", "if (!canRetry) {"]) {
        const start = tail.lastIndexOf(prefix);
        if (
          start !== -1 &&
          start < end &&
          !patterns.some((pattern) => pattern.test(tail.slice(start)))
        )
          end = start;
      }
    }
    end = unicodeCut(tail, end);
    if (end > 0) stream.push(gateWakuEntry(tail.slice(0, end)));
    tail = tail.slice(end);
  }
}

function unicodeCut(value: string, end: number): number {
  const before = value.charCodeAt(end - 1);
  const after = value.charCodeAt(end);
  return before >= 0xd8_00 && before <= 0xdb_ff && after >= 0xdc_00 && after <= 0xdf_ff
    ? end - 1
    : end;
}
