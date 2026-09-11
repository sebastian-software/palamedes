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
      .pipeThrough(Transform.toWeb(createDelayedFailureProbeTransform()));
    context.res = new Response(body, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  };
}

const FAILURE_REPLACEMENT = "document.body.replaceChildren(template.content.cloneNode(true));";
const DELAYED_FAILURE_REPLACEMENT =
  "setTimeout(() => document.body.replaceChildren(template.content.cloneNode(true)), 100);";

/**
 * Waku's own entry module is emitted after the adapter's import probe. Delay
 * replacing the SSR shell for one task window so that a rejected fragment
 * cannot be followed by Waku hydrating and clearing the host error document.
 * The transform keeps only a marker-sized tail, preserving streaming.
 */
function createDelayedFailureProbeTransform(): Transform {
  let pending = "";
  return new Transform({
    transform(chunk, _encoding, callback) {
      pending += chunk.toString("utf8");
      const markerIndex = pending.indexOf(FAILURE_REPLACEMENT);
      if (markerIndex >= 0) {
        this.push(
          pending.slice(0, markerIndex) +
            DELAYED_FAILURE_REPLACEMENT +
            pending.slice(markerIndex + FAILURE_REPLACEMENT.length),
        );
        pending = "";
      } else if (pending.length > FAILURE_REPLACEMENT.length) {
        const keep = FAILURE_REPLACEMENT.length - 1;
        this.push(pending.slice(0, -keep));
        pending = pending.slice(-keep);
      }
      callback();
    },
    flush(callback) {
      if (pending) this.push(pending);
      callback();
    },
  });
}
