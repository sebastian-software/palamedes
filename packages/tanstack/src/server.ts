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

/** The request middleware context TanStack Start passes to request middleware. */
export type TanStackRequestContext = Readonly<Record<string, unknown>>;

/**
 * Resolves a document request's CSP nonce, for example from a value an earlier
 * request middleware passed on through `next({ context })`.
 */
export type TanStackNonceResolver = (
  request: Request,
  context: TanStackRequestContext,
) => string | undefined;

export type TanStackCatalogDeliveryOptions = {
  /** Built client output; defaults to `dist/client` from the host process. */
  readonly clientDirectory?: string;
  /**
   * Use development-generated active-locale dependencies before a client build
   * exists. Defaults to whether Vite built the server as a development build
   * (`import.meta.env.DEV`), not to the runtime `NODE_ENV`.
   */
  readonly development?: boolean;
  /** Override the generated manifest filename for a custom Vite output. */
  readonly manifestName?: string;
  /** Trusted catalog-independent markup rendered when a catalog fails. */
  readonly errorHtml?: string;
  /**
   * The CSP nonce for the import map and readiness script: a fixed string, or
   * a resolver called once per HTML document request.
   */
  readonly nonce?: string | TanStackNonceResolver;
};

type TanStackResponseResult = Response | Record<string, unknown>;

/**
 * Whether Vite built this server as a development build. This module imports
 * a Vite virtual module, and TanStack Start keeps packages that peer-depend on
 * it in Vite's server module graph, so Vite replaces `import.meta.env.DEV` in
 * both `vite dev` and `vite build`. A production build therefore delivers its
 * client catalogs even when the process that serves it has no `NODE_ENV`.
 */
function isDevelopmentBuild(): boolean {
  // Keep the literal `import.meta.env.DEV`: bundlers replace that expression.
  if (import.meta.env === undefined) return process.env.NODE_ENV !== "production";
  return import.meta.env.DEV;
}

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
): (
  result: unknown,
  locale: string,
  request: Request,
  context?: TanStackRequestContext,
) => Promise<unknown> {
  const resolvedOptions = {
    ...options,
    // A caller commonly supplies only a request nonce. Keep the framework's
    // default output location in that case instead of passing an undefined
    // clientDirectory into the shared Vite delivery factory.
    clientDirectory: options.clientDirectory ?? path.resolve(process.cwd(), "dist/client"),
    development: options.development ?? isDevelopmentBuild(),
  };
  const delivery = createViteCatalogDelivery(resolvedOptions);
  return async (result, locale, request, context = {}) => {
    const response = result instanceof Response ? result : getNestedResponse(result);
    if (!response || !response.body || !isHtmlResponse(response)) return result;
    const binding = delivery.getLocaleBinding(locale);
    const nonce =
      typeof resolvedOptions.nonce === "function"
        ? resolvedOptions.nonce(request, context)
        : resolvedOptions.nonce;
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
const MAX_SCRIPT_BUFFER_LENGTH = 256 * 1024;
const UNSAFE_SCRIPT_SOURCE_PATTERN = /[<>]|\p{Cc}/u;

let driftWarned = false;

const DRIFT_MESSAGE =
  "@palamedes/tanstack found a built module script under /assets/ but none matching assets/index-*.js to gate, " +
  "so client catalogs may load late and pages may flash untranslated text. " +
  "The installed TanStack Start version probably changed its entry naming; please report this at https://github.com/sebastian-software/palamedes/issues.";

/**
 * The bootstrap gate matches upstream output by name. When a built module
 * script is present but none was gated, the gate is silently off. Keep serving
 * the page and log one warning per process.
 */
function reportBootstrapDrift(): void {
  if (driftWarned) return;
  driftWarned = true;
  console.warn(`[palamedes] ${DRIFT_MESSAGE}`);
}

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
  let mode: "text" | "opening-tag" | "gated-script" | "pass-through-script" = "text";
  let buffered = "";
  let scanOffset = 0;
  let tagQuote: "" | '"' | "'" = "";
  let gatedOpeningEnd = -1;
  let gatedSource = "";
  let closeTagStart = -1;
  let gatedEntries = 0;
  let unmatchedAssetScripts = 0;

  return new Transform({
    transform(chunk: unknown, _encoding: BufferEncoding, callback: TransformCallback) {
      let output: string;
      try {
        buffered += decodeChunk(decoder, chunk);
        output = flushMarkup(false);
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      if (output) {
        callback(null, output);
      } else {
        callback();
      }
    },
    flush(callback) {
      let output: string;
      try {
        buffered += decoder.end();
        output = flushMarkup(true);
        if (gatedEntries === 0 && unmatchedAssetScripts > 0) reportBootstrapDrift();
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      if (output) {
        callback(null, output);
      } else {
        callback();
      }
    },
  });

  function flushMarkup(final: boolean): string {
    const parts: string[] = [];
    let cursor = 0;

    while (cursor < buffered.length) {
      if (mode === "text") {
        const openMatch = findScriptOpen(buffered, cursor);
        if (openMatch.kind === "none") {
          parts.push(buffered.slice(cursor));
          cursor = buffered.length;
          break;
        }
        if (openMatch.kind === "incomplete") {
          if (final) {
            parts.push(buffered.slice(cursor));
            cursor = buffered.length;
          } else if (openMatch.index > cursor) {
            parts.push(buffered.slice(cursor, openMatch.index));
            cursor = openMatch.index;
          }
          break;
        }
        if (openMatch.index > cursor) {
          parts.push(buffered.slice(cursor, openMatch.index));
          cursor = openMatch.index;
        }
        mode = "opening-tag";
        scanOffset = cursor + "<script".length;
        tagQuote = "";
        continue;
      }

      if (mode === "opening-tag") {
        const scan = scanTagEnd(buffered, scanOffset, tagQuote);
        tagQuote = scan.quote;
        if (scan.index === -1) {
          scanOffset = buffered.length;
          if (final || buffered.length - cursor > MAX_SCRIPT_BUFFER_LENGTH) {
            parts.push(buffered.slice(cursor));
            cursor = buffered.length;
            mode = "text";
            scanOffset = 0;
            tagQuote = "";
          }
          break;
        }
        const openingEnd = scan.index;
        const openingTag = buffered.slice(cursor, openingEnd + 1);
        tagQuote = "";
        const candidate = readTagAttribute(openingTag, "src");
        const source =
          candidate && isTanStackEntryScript(openingTag, candidate, options)
            ? candidate
            : undefined;
        if (source) {
          mode = "gated-script";
          gatedOpeningEnd = openingEnd;
          gatedSource = source;
          scanOffset = openingEnd + 1;
          closeTagStart = -1;
          continue;
        }
        if (candidate && isBuiltAssetModuleScript(openingTag, candidate, options)) {
          unmatchedAssetScripts += 1;
        }
        parts.push(openingTag);
        cursor = openingEnd + 1;
        mode = "pass-through-script";
        scanOffset = cursor;
        closeTagStart = -1;
        continue;
      }

      if (mode === "pass-through-script") {
        if (closeTagStart === -1) {
          const closeMatch = findScriptCloseStart(buffered, scanOffset);
          if (closeMatch.kind === "none") {
            parts.push(buffered.slice(cursor));
            cursor = buffered.length;
            scanOffset = 0;
            break;
          }
          if (closeMatch.kind === "incomplete") {
            if (final) {
              parts.push(buffered.slice(cursor));
              cursor = buffered.length;
              mode = "text";
              scanOffset = 0;
            } else {
              if (closeMatch.index > cursor) {
                parts.push(buffered.slice(cursor, closeMatch.index));
                cursor = closeMatch.index;
              }
              scanOffset = cursor;
            }
            break;
          }
          if (closeMatch.index > cursor) {
            parts.push(buffered.slice(cursor, closeMatch.index));
            cursor = closeMatch.index;
          }
          closeTagStart = cursor;
          scanOffset = cursor + "</script".length;
          tagQuote = "";
        }

        const closeEnd = scanTagEnd(buffered, scanOffset, tagQuote);
        tagQuote = closeEnd.quote;
        if (closeEnd.index === -1) {
          scanOffset = buffered.length;
          if (final || buffered.length - cursor > MAX_SCRIPT_BUFFER_LENGTH) {
            parts.push(buffered.slice(cursor));
            cursor = buffered.length;
            mode = "text";
            closeTagStart = -1;
            scanOffset = 0;
            tagQuote = "";
          }
          break;
        }
        parts.push(buffered.slice(cursor, closeEnd.index + 1));
        cursor = closeEnd.index + 1;
        mode = "text";
        closeTagStart = -1;
        scanOffset = 0;
        tagQuote = "";
        continue;
      }

      // mode === "gated-script"
      if (closeTagStart === -1) {
        const closeMatch = findScriptCloseStart(buffered, scanOffset);
        if (closeMatch.kind === "found") {
          closeTagStart = closeMatch.index;
          scanOffset = closeMatch.index + "</script".length;
          tagQuote = "";
          continue;
        }
        if (final) {
          parts.push(buffered.slice(cursor));
          cursor = buffered.length;
          mode = "text";
          gatedOpeningEnd = -1;
          gatedSource = "";
          scanOffset = 0;
          break;
        }
        if (buffered.length - cursor > MAX_SCRIPT_BUFFER_LENGTH) {
          if (closeMatch.kind === "incomplete") {
            parts.push(buffered.slice(cursor, closeMatch.index));
            cursor = closeMatch.index;
          } else {
            parts.push(buffered.slice(cursor));
            cursor = buffered.length;
          }
          mode = "pass-through-script";
          gatedOpeningEnd = -1;
          gatedSource = "";
          scanOffset = cursor;
          closeTagStart = -1;
          break;
        }
        scanOffset = closeMatch.kind === "incomplete" ? closeMatch.index : buffered.length;
        break;
      }

      const gatedCloseEnd = scanTagEnd(buffered, scanOffset, tagQuote);
      tagQuote = gatedCloseEnd.quote;
      if (gatedCloseEnd.index === -1) {
        scanOffset = buffered.length;
        if (final) {
          parts.push(buffered.slice(cursor));
          cursor = buffered.length;
          mode = "text";
          gatedOpeningEnd = -1;
          gatedSource = "";
          closeTagStart = -1;
          scanOffset = 0;
          tagQuote = "";
          break;
        }
        if (buffered.length - cursor > MAX_SCRIPT_BUFFER_LENGTH) {
          if (buffered.length - closeTagStart > MAX_SCRIPT_BUFFER_LENGTH) {
            parts.push(buffered.slice(cursor));
            cursor = buffered.length;
            mode = "text";
            closeTagStart = -1;
            scanOffset = 0;
            tagQuote = "";
          } else {
            parts.push(buffered.slice(cursor, closeTagStart));
            cursor = closeTagStart;
            mode = "pass-through-script";
          }
          gatedOpeningEnd = -1;
          gatedSource = "";
        }
        break;
      }

      const gatedOpeningTag = buffered.slice(cursor, gatedOpeningEnd + 1);
      gatedEntries += 1;
      parts.push(gateTanStackEntry(gatedOpeningTag, gatedSource, options));
      cursor = gatedCloseEnd.index + 1;
      mode = "text";
      gatedOpeningEnd = -1;
      gatedSource = "";
      closeTagStart = -1;
      scanOffset = 0;
      tagQuote = "";
    }

    if (cursor > 0) {
      buffered = cursor >= buffered.length ? "" : buffered.slice(cursor);
      if (scanOffset > 0) scanOffset = Math.max(0, scanOffset - cursor);
      if (gatedOpeningEnd >= 0) gatedOpeningEnd -= cursor;
      if (closeTagStart >= 0) closeTagStart -= cursor;
    }
    return parts.length === 0 ? "" : parts.length === 1 ? parts[0]! : parts.join("");
  }
}

function isTanStackEntryScript(
  openingTag: string,
  source: string,
  options: { allowedOrigins: ReadonlySet<string>; baseOrigin: string },
): boolean {
  if (UNSAFE_SCRIPT_SOURCE_PATTERN.test(source)) return false;
  const type = readTagAttribute(openingTag, "type");
  return (
    type?.toLowerCase() === "module" &&
    isAllowedScriptOrigin(source, options) &&
    /(?:^|\/)assets\/index-[^/?#]+\.js(?:[?#].*)?$/iu.test(source)
  );
}

/** A same-origin module script from the build's assets directory that is not the entry. */
function isBuiltAssetModuleScript(
  openingTag: string,
  source: string,
  options: { allowedOrigins: ReadonlySet<string>; baseOrigin: string },
): boolean {
  if (UNSAFE_SCRIPT_SOURCE_PATTERN.test(source)) return false;
  return (
    readTagAttribute(openingTag, "type")?.toLowerCase() === "module" &&
    isAllowedScriptOrigin(source, options) &&
    /(?:^|\/)assets\/[^/?#]+\.js(?:[?#].*)?$/iu.test(source)
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
  const serializedSource = escapeScriptData(JSON.stringify(source));
  const importExpression = options.development
    ? `(globalThis[${CATALOG_READY_PROMISE}] ? globalThis[${CATALOG_READY_PROMISE}].then(() => import(${serializedSource})) : import(${serializedSource}))`
    : `globalThis[${CATALOG_READY_PROMISE}].then(() => import(${serializedSource}))`;
  return `${trustedOpeningTag}${importExpression}.catch((error) => { if (globalThis[${CATALOG_READY}] || !globalThis[${CATALOG_READY_PROMISE}]) throw error; });</script>`;
}

function escapeScriptData(value: string): string {
  return value
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
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

function decodeChunk(decoder: StringDecoder, chunk: unknown): string {
  if (Buffer.isBuffer(chunk)) return decoder.write(chunk);
  if (chunk instanceof Uint8Array) {
    return decoder.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
  }
  return String(chunk);
}

function findScriptOpen(
  value: string,
  from: number,
): { kind: "found"; index: number } | { kind: "incomplete"; index: number } | { kind: "none" } {
  return findAsciiTagStart(value, from, "<script");
}

function findScriptCloseStart(
  value: string,
  from: number,
): { kind: "found"; index: number } | { kind: "incomplete"; index: number } | { kind: "none" } {
  return findAsciiTagStart(value, from, "</script");
}

function findAsciiTagStart(
  value: string,
  from: number,
  lowerNeedle: string,
): { kind: "found"; index: number } | { kind: "incomplete"; index: number } | { kind: "none" } {
  let cursor = from;
  while (cursor < value.length) {
    const lt = value.indexOf("<", cursor);
    if (lt === -1) return { kind: "none" };
    const remaining = value.length - lt;
    if (remaining <= lowerNeedle.length) {
      if (asciiPrefixIgnoreCase(lowerNeedle, value, lt)) {
        return { kind: "incomplete", index: lt };
      }
      cursor = lt + 1;
      continue;
    }
    if (
      asciiEqualsIgnoreCase(value, lt, lowerNeedle) &&
      isHtmlTagBoundary(value.charCodeAt(lt + lowerNeedle.length))
    ) {
      return { kind: "found", index: lt };
    }
    cursor = lt + 1;
  }
  return { kind: "none" };
}

function asciiEqualsIgnoreCase(value: string, offset: number, lowerTarget: string): boolean {
  if (offset + lowerTarget.length > value.length) return false;
  for (let index = 0; index < lowerTarget.length; index += 1) {
    let code = value.charCodeAt(offset + index);
    if (code >= 65 && code <= 90) code += 32;
    if (code !== lowerTarget.charCodeAt(index)) return false;
  }
  return true;
}

function asciiPrefixIgnoreCase(lowerTarget: string, value: string, offset: number): boolean {
  const length = value.length - offset;
  if (length > lowerTarget.length) return false;
  for (let index = 0; index < length; index += 1) {
    let code = value.charCodeAt(offset + index);
    if (code >= 65 && code <= 90) code += 32;
    if (code !== lowerTarget.charCodeAt(index)) return false;
  }
  return true;
}

function isHtmlTagBoundary(code: number): boolean {
  return (
    code === 32 ||
    code === 9 ||
    code === 10 ||
    code === 12 ||
    code === 13 ||
    code === 47 /* / */ ||
    code === 62 /* > */
  );
}

function scanTagEnd(
  value: string,
  from: number,
  initialQuote: "" | '"' | "'",
): { index: number; quote: "" | '"' | "'" } {
  let quote = initialQuote;
  for (let index = from; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return { index, quote: "" };
    }
  }
  return { index: -1, quote };
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
