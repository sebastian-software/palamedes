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
        Transform.toWeb(
          delivery.createDocumentTransform(binding, {
            ...(options.errorHtml ? { errorHtml: options.errorHtml } : {}),
            ...(nonce ? { nonce } : {}),
          }),
        ),
      )
      .pipeThrough(
        Transform.toWeb(nonce ? createWakuScriptNonceTransform(nonce) : createPassThrough()),
      )
      .pipeThrough(
        Transform.toWeb(
          createWakuBootstrapGateTransform({ allowMissingPromise: options.development === true }),
        ),
      );
    context.res = new Response(body, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  };
}

const CATALOG_READY_PROMISE = 'Symbol.for("palamedes.document-catalogs-ready-promise")';
const CATALOG_READY = 'Symbol.for("palamedes.document-catalogs-ready")';
const WAKU_ENTRY_PATTERN = /import\(((['"])\/assets\/index-[^"']+\.js\2)\)/u;
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
    while (true) {
      const match = WAKU_ENTRY_PATTERN.exec(tail);
      if (match) {
        const end = match.index + match[0].length;
        if (!flush && end > tail.length - TAIL_SIZE) break;
        stream.push(gateWakuEntry(tail.slice(0, end)));
        tail = tail.slice(end);
        continue;
      }
      if (flush) {
        if (tail) stream.push(gateWakuEntry(tail));
        tail = "";
      } else if (tail.length > TAIL_SIZE) {
        const safeEnd = tail.length - TAIL_SIZE;
        stream.push(tail.slice(0, safeEnd));
        tail = tail.slice(safeEnd);
      }
      return;
    }
  }
}

function createWakuScriptNonceTransform(nonce: string): Transform {
  const decoder = new StringDecoder("utf8");
  let tail = "";
  let inScript = false;
  const escapedNonce = escapeAttribute(nonce);

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
    while (true) {
      if (inScript) {
        const close = /<\/script\s*>/iu.exec(tail);
        if (close) {
          const end = close.index + close[0].length;
          if (!flush && end > tail.length - TAIL_SIZE) break;
          stream.push(tail.slice(0, end));
          tail = tail.slice(end);
          inScript = false;
          continue;
        }
        if (flush) {
          if (tail) stream.push(tail);
          tail = "";
        } else if (tail.length > TAIL_SIZE) {
          const safeEnd = tail.length - TAIL_SIZE;
          stream.push(tail.slice(0, safeEnd));
          tail = tail.slice(safeEnd);
        }
        return;
      }

      const match = /<script\b[^>]*>/iu.exec(tail);
      if (match) {
        const end = match.index + match[0].length;
        if (!flush && end > tail.length - TAIL_SIZE) break;
        const tag = match[0].match(/\bnonce\s*=/iu)
          ? match[0]
          : `${match[0].slice(0, -1)} nonce="${escapedNonce}">`;
        stream.push(tail.slice(0, match.index) + tag);
        tail = tail.slice(end);
        inScript = true;
        continue;
      }
      if (flush) {
        if (tail) stream.push(tail);
        tail = "";
      } else if (tail.length > TAIL_SIZE) {
        const safeEnd = tail.length - TAIL_SIZE;
        stream.push(tail.slice(0, safeEnd));
        tail = tail.slice(safeEnd);
      }
      return;
    }
  }
}

function createPassThrough(): Transform {
  return new Transform({
    transform(chunk, _encoding, callback) {
      this.push(chunk);
      callback();
    },
  });
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}
