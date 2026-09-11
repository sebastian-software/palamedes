import { Transform } from "node:stream";
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
const WAKU_ENTRY_PATTERN =
  /import\(((["'])\/assets\/index-[^"']+\.js\2)\)\.catch\(\(err\) =>/u;
const HEAD_END = "</head>";
const TAIL_SIZE = 192;

/**
 * Waku emits an inline entry bootstrap after the document head. Gate that
 * import on the exact same catalog-import promise used by the delivery probe.
 * This keeps Waku from mounting over the host error document when an initial
 * fragment fails, without timing delays or app-owned DOM handling.
 */
function createWakuBootstrapGateTransform(options: { allowMissingPromise: boolean }): Transform {
  let head = "";
  let headComplete = false;
  let tail = "";

  function gateCatalogProbe(value: string) {
    if (!value.includes("try{await Promise.all(")) return value;
    return value.replace(
      "try{await Promise.all(",
      `try{globalThis[${CATALOG_READY_PROMISE}]=Promise.all(`,
    ).replace(
      `);globalThis[${CATALOG_READY}]=true`,
      `);await globalThis[${CATALOG_READY_PROMISE}];globalThis[${CATALOG_READY}]=true`,
    );
  }

  function gateWakuEntry(value: string) {
    const importExpression = options.allowMissingPromise
      ? `(globalThis[${CATALOG_READY_PROMISE}] ? globalThis[${CATALOG_READY_PROMISE}].then(() => import($1)) : import($1))`
      : `globalThis[${CATALOG_READY_PROMISE}].then(() => import($1))`;
    return value.replace(
      WAKU_ENTRY_PATTERN,
      `${importExpression}.catch((err) =>`,
    );
  }

  return new Transform({
    transform(chunk, _encoding, callback) {
      const value = chunk.toString("utf8");
      if (!headComplete) {
        head += value;
        const headEnd = head.indexOf(HEAD_END);
        if (headEnd < 0) {
          callback();
          return;
        }
        headComplete = true;
        const transformedHead = gateCatalogProbe(head.slice(0, headEnd + HEAD_END.length));
        this.push(transformedHead);
        tail = head.slice(headEnd + HEAD_END.length);
        head = "";
      } else {
        tail += value;
      }
      if (tail.length > TAIL_SIZE) {
        this.push(gateWakuEntry(tail.slice(0, -TAIL_SIZE)));
        tail = tail.slice(-TAIL_SIZE);
      }
      callback();
    },
    flush(callback) {
      if (!headComplete) this.push(gateCatalogProbe(head));
      else if (tail) this.push(gateWakuEntry(tail));
      callback();
    },
  });
}
