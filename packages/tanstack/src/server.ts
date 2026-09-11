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
    body = body.pipeThrough(
      Transform.toWeb(
        createTanStackBootstrapGateTransform({ development: options.development === true }),
      ) as unknown as ReadableWritablePair,
    );
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
  let insideScript = false;
  const escaped = escapeAttribute(nonce);

  const flushMarkup = (final: boolean): string => {
    const lower = buffered.toLowerCase();
    let cursor = 0;
    let output = "";

    while (cursor < buffered.length) {
      if (insideScript) {
        const close = lower.indexOf("</script", cursor);
        if (close === -1) {
          const keep = final ? buffered.length : trailingPrefixLength(lower, cursor, "</script");
          output += buffered.slice(cursor, keep);
          cursor = keep;
          break;
        }
        output += buffered.slice(cursor, close);
        insideScript = false;
        cursor = close;
        continue;
      }

      const open = findScriptOpen(lower, cursor);
      if (open === -1) {
        const keep = final ? buffered.length : trailingPrefixLength(lower, cursor, "<script");
        output += buffered.slice(cursor, keep);
        cursor = keep;
        break;
      }

      output += buffered.slice(cursor, open);
      const end = findTagEnd(buffered, open);
      if (end === -1) {
        cursor = open;
        break;
      }

      let openingTag = buffered.slice(open, end + 1);
      if (!/(?:[\s<])nonce\s*=/iu.test(openingTag)) {
        openingTag = openingTag.replace(/^<script\b/iu, (match) => `${match} nonce="${escaped}"`);
      }
      output += openingTag;
      insideScript = true;
      cursor = end + 1;
    }

    buffered = buffered.slice(cursor);
    return output;
  };

  return new Transform({
    transform(chunk: unknown, _encoding: BufferEncoding, callback: TransformCallback) {
      buffered += Buffer.isBuffer(chunk) ? decoder.write(chunk) : String(chunk);
      callback(null, flushMarkup(false));
    },
    flush(callback) {
      buffered += decoder.end();
      callback(null, flushMarkup(true));
    },
  });
}

const TANSTACK_ENTRY_PATTERN = /\ssrc=(['"])(\/assets\/index-[^'"]+\.js)\1/iu;
const CATALOG_READY_PROMISE = 'Symbol.for("palamedes.document-catalogs-ready-promise")';
const CATALOG_READY = 'Symbol.for("palamedes.document-catalogs-ready")';

/**
 * TanStack Start emits its browser entry as a module script rather than an
 * inline bootstrap. Gate that exact entry on the delivery probe's shared
 * promise so a rejected catalog cannot be followed by framework hydration
 * over the host's catalog error document.
 */
function createTanStackBootstrapGateTransform(options: { development: boolean }): Transform {
  const decoder = new StringDecoder("utf8");
  let buffered = "";

  return new Transform({
    transform(chunk: unknown, _encoding: BufferEncoding, callback: TransformCallback) {
      buffered += Buffer.isBuffer(chunk) ? decoder.write(chunk) : String(chunk);
      callback(null, flushMarkup(false));
    },
    flush(callback) {
      buffered += decoder.end();
      callback(null, flushMarkup(true));
    },
  });

  function flushMarkup(final: boolean): string {
    const lower = buffered.toLowerCase();
    let cursor = 0;
    let output = "";
    while (cursor < buffered.length) {
      const open = findScriptOpen(lower, cursor);
      if (open === -1) {
        const keep = final ? buffered.length : trailingPrefixLength(lower, cursor, "<script");
        output += buffered.slice(cursor, keep);
        cursor = keep;
        break;
      }
      output += buffered.slice(cursor, open);
      const openingEnd = findTagEnd(buffered, open);
      if (openingEnd === -1) {
        cursor = open;
        break;
      }
      const close = lower.indexOf("</script", openingEnd + 1);
      if (close === -1) {
        cursor = open;
        break;
      }
      const closingEnd = findTagEnd(buffered, close);
      if (closingEnd === -1) {
        cursor = open;
        break;
      }
      const openingTag = buffered.slice(open, openingEnd + 1);
      const source = openingTag.match(TANSTACK_ENTRY_PATTERN)?.[2];
      output += source
        ? gateTanStackEntry(openingTag, source, options.development)
        : buffered.slice(open, closingEnd + 1);
      cursor = closingEnd + 1;
    }
    buffered = buffered.slice(cursor);
    return output;
  }
}

function gateTanStackEntry(openingTag: string, source: string, development: boolean): string {
  const withoutSource = openingTag.replace(/\s+src=(['"])[^'"]+\1/iu, "");
  const importExpression = development
    ? `(globalThis[${CATALOG_READY_PROMISE}] ? globalThis[${CATALOG_READY_PROMISE}].then(() => import(${JSON.stringify(source)})) : import(${JSON.stringify(source)}))`
    : `globalThis[${CATALOG_READY_PROMISE}].then(() => import(${JSON.stringify(source)}))`;
  return `${withoutSource}${importExpression}.catch((error) => { if (globalThis[${CATALOG_READY}] || !globalThis[${CATALOG_READY_PROMISE}]) throw error; });</script>`;
}

function findScriptOpen(lower: string, from: number): number {
  let index = lower.indexOf("<script", from);
  while (index !== -1) {
    const next = lower[index + "<script".length];
    if (next === undefined || /[\s/>]/u.test(next)) return index;
    index = lower.indexOf("<script", index + 1);
  }
  return -1;
}

function findTagEnd(value: string, from: number): number {
  let quote = "";
  for (let index = from; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return -1;
}

function trailingPrefixLength(value: string, from: number, prefix: string): number {
  const suffix = value.slice(from);
  const max = Math.min(prefix.length, suffix.length);
  for (let length = max; length > 0; length -= 1) {
    if (suffix.endsWith(prefix.slice(0, length))) return value.length - length;
  }
  return value.length;
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
