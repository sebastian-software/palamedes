import { createI18n, type CreateI18nOptions, type PalamedesI18n } from "@palamedes/core";
import {
  createViteCatalogDelivery,
  type ViteCatalogDeliveryOptions,
  type ViteDocumentTransformOptions,
} from "@palamedes/vite-plugin/delivery";
import path from "node:path";
import { Transform, type TransformCallback } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { loadServerCatalog } from "virtual:palamedes/server-catalogs";

/** Options for one request-local TanStack Start i18n instance. */
export type TanStackServerI18nOptions = CreateI18nOptions & {
  /** The active locale selected by the host's request policy. */
  readonly locale: string;
};

export type TanStackCatalogDeliveryOptions = ViteCatalogDeliveryOptions & {
  /** Trusted catalog-independent markup rendered when a catalog fails. */
  readonly errorHtml?: string;
  /** Resolve a CSP nonce for each request. */
  readonly nonce?: string | ((request: Request) => string | undefined);
};

type TanStackResponseResult = Response | Record<string, unknown>;

/**
 * Load the active generated catalog and create a fresh parser-free instance.
 *
 * `virtual:palamedes/server-catalogs` is supplied by the Vite adapter. It
 * owns configured catalog imports and the shared immutable server store, so
 * an application only supplies request locale and time-zone policy.
 */
export async function createTanStackServerI18n(
  options: TanStackServerI18nOptions,
): Promise<PalamedesI18n> {
  const messages = await loadServerCatalog(options.locale);
  const i18n = createI18n(options);
  i18n.load(options.locale, messages);
  return i18n;
}

/**
 * Creates the response transport used by the request middleware. TanStack
 * Start's router middleware returns either a Response or a result containing
 * one; both forms are preserved while HTML is transformed before the browser
 * can evaluate its route entry.
 */
export function createTanStackCatalogResponseDelivery(
  options: TanStackCatalogDeliveryOptions = {
    // TanStack Start's Vite builder writes the browser graph to dist/client.
    // Hosts can override this when they customize `build.outDir`.
    clientDirectory: path.resolve(process.cwd(), "dist/client"),
    development: process.env.NODE_ENV !== "production",
  },
): (result: unknown, locale: string, request: Request) => Promise<unknown> {
  const delivery = createViteCatalogDelivery(options);
  return async (result, locale, request) => {
    const response = result instanceof Response ? result : getNestedResponse(result);
    if (!response || !response.body || !isHtmlResponse(response)) return result;
    const binding = delivery.getLocaleBinding(locale);
    const nonce = options.nonce
      ? typeof options.nonce === "function"
        ? options.nonce(request)
        : options.nonce
      : undefined;
    if (!binding && !nonce) return result;
    const transformOptions: ViteDocumentTransformOptions = {
      ...(options.errorHtml ? { errorHtml: options.errorHtml } : {}),
      ...(nonce ? { nonce } : {}),
    };
    let body = response.body;
    if (binding) {
      body = body.pipeThrough(
        Transform.toWeb(
          delivery.createDocumentTransform(binding, transformOptions),
        ) as unknown as ReadableWritablePair,
      );
    }
    if (nonce) {
      body = body.pipeThrough(
        Transform.toWeb(createScriptNonceTransform(nonce)) as unknown as ReadableWritablePair,
      );
    }
    const headers = new Headers(response.headers);
    // The transformed stream may be longer than the framework's original
    // response. A stale length causes truncated HTML in Node adapters.
    headers.delete("content-length");
    const delivered = new Response(body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
    if (result instanceof Response) return delivered;
    return replaceNestedResponse(result, delivered);
  };
}

/**
 * Framework SSR streams can contain inline bootstrap scripts. When a host
 * supplies a nonce, carry it to those scripts as well as the adapter-owned
 * import map/readiness probe so `script-src 'self' 'nonce-…'` remains usable.
 */
function createScriptNonceTransform(nonce: string): Transform {
  const decoder = new StringDecoder("utf8");
  let buffered = "";
  const escaped = escapeAttribute(nonce);
  return new Transform({
    transform(chunk: unknown, _encoding: BufferEncoding, callback: TransformCallback) {
      buffered += Buffer.isBuffer(chunk) ? decoder.write(chunk) : String(chunk);
      const end = buffered.lastIndexOf(">");
      if (end === -1) {
        callback();
        return;
      }
      const complete = buffered.slice(0, end + 1);
      buffered = buffered.slice(end + 1);
      callback(
        null,
        complete.replace(/<script\b(?![^>]*\bnonce=)/giu, `<script nonce="${escaped}"`),
      );
    },
    flush(callback) {
      buffered += decoder.end();
      callback(
        null,
        buffered.replace(/<script\b(?![^>]*\bnonce=)/giu, `<script nonce="${escaped}"`),
      );
    },
  });
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function isHtmlResponse(response: Response): boolean {
  return response.headers.get("content-type")?.toLowerCase().startsWith("text/html") ?? false;
}

function getNestedResponse(result: unknown): Response | undefined {
  if (!result || typeof result !== "object" || !("response" in result)) return undefined;
  const response = result.response;
  return response instanceof Response ? response : undefined;
}

function replaceNestedResponse(result: unknown, response: Response): TanStackResponseResult {
  if (!result || typeof result !== "object") return result as TanStackResponseResult;
  return { ...(result as Record<string, unknown>), response };
}
