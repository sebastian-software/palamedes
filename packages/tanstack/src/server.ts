import { createI18n, type CreateI18nOptions, type PalamedesI18n } from "@palamedes/core";
import {
  createViteCatalogDelivery,
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

export type TanStackCatalogDeliveryOptions = {
  /** Built client output; defaults to `dist/client` from the host process. */
  readonly clientDirectory?: string;
  /** Use development-generated active-locale dependencies before a client build exists. */
  readonly development?: boolean;
  /** Override the generated manifest filename for a custom Vite output. */
  readonly manifestName?: string;
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
  options: TanStackCatalogDeliveryOptions = {},
): (result: unknown, locale: string, request: Request) => Promise<unknown> {
  const resolvedOptions = {
    ...options,
    // A caller commonly supplies only a request nonce. Keep the framework's
    // default output location in that case instead of passing an undefined
    // clientDirectory into the shared Vite delivery factory.
    clientDirectory: options.clientDirectory ?? path.resolve(process.cwd(), "dist/client"),
    development: options.development ?? process.env.NODE_ENV !== "production",
  };
  const delivery = createViteCatalogDelivery(resolvedOptions);
  return async (result, locale, request) => {
    const response = result instanceof Response ? result : getNestedResponse(result);
    if (!response || !response.body || !isHtmlResponse(response)) return result;
    const binding = delivery.getLocaleBinding(locale);
    const nonce = resolvedOptions.nonce
      ? typeof resolvedOptions.nonce === "function"
        ? resolvedOptions.nonce(request)
        : resolvedOptions.nonce
      : undefined;
    if (!binding && !nonce && resolvedOptions.development !== true) return result;
    const transformOptions: ViteDocumentTransformOptions = {
      ...(resolvedOptions.errorHtml ? { errorHtml: resolvedOptions.errorHtml } : {}),
      ...(nonce ? { nonce } : {}),
    };
    let body = response.body;
    if (binding || resolvedOptions.development === true) {
      body = body.pipeThrough(
        Transform.toWeb(
          delivery.createDocumentTransform(binding, transformOptions),
        ) as unknown as ReadableWritablePair,
      );
    }
    body = body.pipeThrough(
      Transform.toWeb(
        createTanStackBootstrapGateTransform({
          development: resolvedOptions.development === true,
          allowedOrigins: getAllowedScriptOrigins(binding, request.url),
          baseOrigin: new URL(request.url).origin,
        }),
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

const CATALOG_READY_PROMISE = 'Symbol.for("palamedes.document-catalogs-ready-promise")';
const CATALOG_READY = 'Symbol.for("palamedes.document-catalogs-ready")';

/**
 * TanStack Start emits its browser entry as a module script rather than an
 * inline bootstrap. Gate that exact entry on the delivery probe's shared
 * promise so a rejected catalog cannot be followed by framework hydration
 * over the host's catalog error document.
 */
function createTanStackBootstrapGateTransform(options: {
  development: boolean;
  allowedOrigins: ReadonlySet<string>;
  baseOrigin: string;
}): Transform {
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
      const candidate = readTagAttribute(openingTag, "src");
      const source =
        candidate && isTanStackEntryScript(openingTag, candidate, options) ? candidate : undefined;
      output += source
        ? gateTanStackEntry(openingTag, source, options)
        : buffered.slice(open, closingEnd + 1);
      cursor = closingEnd + 1;
    }
    buffered = buffered.slice(cursor);
    return output;
  }
}

function isTanStackEntryScript(
  openingTag: string,
  source: string,
  options: { allowedOrigins: ReadonlySet<string>; baseOrigin: string },
): boolean {
  const type = readTagAttribute(openingTag, "type");
  return (
    type?.toLowerCase() === "module" &&
    isAllowedScriptOrigin(source, options) &&
    /(?:^|\/)assets\/index-[^/?#]+\.js(?:[?#].*)?$/iu.test(source)
  );
}

function gateTanStackEntry(
  openingTag: string,
  source: string,
  options: {
    development: boolean;
    allowedOrigins: ReadonlySet<string>;
    baseOrigin: string;
  },
): string {
  // Preserve the framework's original attributes, including its native CSP
  // nonce. The adapter must never authorize a previously nonced-less script.
  const trustedOpeningTag = removeTagAttribute(openingTag, "src");
  const importExpression = options.development
    ? `(globalThis[${CATALOG_READY_PROMISE}] ? globalThis[${CATALOG_READY_PROMISE}].then(() => import(${JSON.stringify(source)})) : import(${JSON.stringify(source)}))`
    : `globalThis[${CATALOG_READY_PROMISE}].then(() => import(${JSON.stringify(source)}))`;
  return `${trustedOpeningTag}${importExpression}.catch((error) => { if (globalThis[${CATALOG_READY}] || !globalThis[${CATALOG_READY_PROMISE}]) throw error; });</script>`;
}

function getAllowedScriptOrigins(
  binding: { imports: Readonly<Record<string, string>> } | null,
  requestUrl: string,
): ReadonlySet<string> {
  const origins = new Set<string>([new URL(requestUrl).origin]);
  if (!binding) return origins;
  for (const asset of Object.values(binding.imports)) {
    try {
      origins.add(new URL(asset, requestUrl).origin);
    } catch {
      // Invalid generated URLs are rejected by the Vite delivery validator;
      // do not let one malformed value weaken script-origin checks here.
    }
  }
  return origins;
}

function isAllowedScriptOrigin(
  source: string,
  options: { allowedOrigins: ReadonlySet<string>; baseOrigin: string },
): boolean {
  try {
    return options.allowedOrigins.has(new URL(source, options.baseOrigin).origin);
  } catch {
    return false;
  }
}

/** Read one opening-tag attribute without treating quoted data as markup. */
function readTagAttribute(tag: string, name: string): string | undefined {
  let cursor = tag.indexOf("<") + 1;
  while (cursor < tag.length && /[^\s/>]/u.test(tag[cursor] ?? "")) cursor += 1;
  while (cursor < tag.length) {
    while (cursor < tag.length && /[\s/]/u.test(tag[cursor] ?? "")) cursor += 1;
    if (tag[cursor] === ">" || cursor >= tag.length) return undefined;
    const nameStart = cursor;
    while (cursor < tag.length && /[^\s=/>]/u.test(tag[cursor] ?? "")) cursor += 1;
    const attributeName = tag.slice(nameStart, cursor).toLowerCase();
    while (cursor < tag.length && /\s/u.test(tag[cursor] ?? "")) cursor += 1;
    let value: string | undefined;
    if (tag[cursor] === "=") {
      cursor += 1;
      while (cursor < tag.length && /\s/u.test(tag[cursor] ?? "")) cursor += 1;
      const quote = tag[cursor];
      if (quote === '"' || quote === "'") {
        cursor += 1;
        const valueStart = cursor;
        while (cursor < tag.length && tag[cursor] !== quote) cursor += 1;
        value = tag.slice(valueStart, cursor);
        if (cursor < tag.length) cursor += 1;
      } else {
        const valueStart = cursor;
        while (cursor < tag.length && /[^\s>]/u.test(tag[cursor] ?? "")) cursor += 1;
        value = tag.slice(valueStart, cursor);
      }
    }
    if (attributeName === name.toLowerCase()) return value ?? "";
    while (cursor < tag.length && /\s/u.test(tag[cursor] ?? "")) cursor += 1;
  }
  return undefined;
}

function removeTagAttribute(tag: string, name: string): string {
  const range = findTagAttribute(tag, name);
  if (!range) return tag;
  const start =
    range.start > 0 && /\s/u.test(tag[range.start - 1] ?? "") ? range.start - 1 : range.start;
  return `${tag.slice(0, start)}${tag.slice(range.end)}`;
}

function findTagAttribute(tag: string, name: string): { start: number; end: number } | undefined {
  let cursor = tag.indexOf("<") + 1;
  while (cursor < tag.length && /[^\s/>]/u.test(tag[cursor] ?? "")) cursor += 1;
  while (cursor < tag.length) {
    while (cursor < tag.length && /[\s/]/u.test(tag[cursor] ?? "")) cursor += 1;
    if (tag[cursor] === ">" || cursor >= tag.length) return undefined;
    const start = cursor;
    while (cursor < tag.length && /[^\s=/>]/u.test(tag[cursor] ?? "")) cursor += 1;
    const attributeName = tag.slice(start, cursor).toLowerCase();
    while (cursor < tag.length && /\s/u.test(tag[cursor] ?? "")) cursor += 1;
    if (tag[cursor] === "=") {
      cursor += 1;
      while (cursor < tag.length && /\s/u.test(tag[cursor] ?? "")) cursor += 1;
      const quote = tag[cursor];
      if (quote === '"' || quote === "'") {
        cursor += 1;
        while (cursor < tag.length && tag[cursor] !== quote) cursor += 1;
        if (cursor < tag.length) cursor += 1;
      } else {
        while (cursor < tag.length && /[^\s>]/u.test(tag[cursor] ?? "")) cursor += 1;
      }
    }
    if (attributeName === name.toLowerCase()) return { start, end: cursor };
  }
  return undefined;
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
