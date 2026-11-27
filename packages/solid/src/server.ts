import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { Transform, type TransformCallback } from "node:stream";
import { createViteCatalogDelivery } from "@palamedes/vite-plugin/delivery";

/**
 * Resolves a document request's CSP nonce. Solid's Fetch middleware has no
 * context object of its own, so the resolver receives only the request.
 */
export type SolidNonceResolver = (request: Request) => string | undefined;

export type SolidCatalogDeliveryOptions = {
  /**
   * Built Nitro/Vite client directory containing palamedes-split-manifest.json.
   * Defaults to Nitro's `.output/public` in the process working directory.
   */
  clientDirectory?: string;
  /** Resolve the application-owned locale policy from the original request. */
  resolveLocale: (request: Request) => string;
  /**
   * Allow running before a client build exists in development. Defaults to
   * whether Vite built the server as a development build
   * (`import.meta.env.DEV`), not to the runtime `NODE_ENV`.
   */
  development?: boolean;
  /** Override the generated manifest filename for a custom Vite output. */
  manifestName?: string;
  /** Optional catalog-free host UI for initial fragment failures. */
  errorHtml?: string;
  /**
   * CSP nonce for Palamedes-generated import maps and bootstrap scripts: a
   * fixed string, or a resolver called once per HTML document request.
   */
  nonce?: string | SolidNonceResolver;
};

export type SolidFetchMiddleware = (
  request: Request,
  next: () => Promise<Response>,
) => Promise<Response>;

/**
 * Whether Vite built this server as a development build. Vite replaces
 * `import.meta.env.DEV` in both `vite dev` and `vite build`, so a production
 * build delivers its client catalogs even when the process that serves it has
 * no `NODE_ENV`, and a development server keeps development delivery under
 * `NODE_ENV=production`. Outside Vite, `NODE_ENV` decides.
 */
function isDevelopmentBuild(): boolean {
  // Keep the literal `import.meta.env.DEV`: bundlers replace that expression.
  if (import.meta.env === undefined) return process.env.NODE_ENV !== "production";
  return import.meta.env.DEV;
}

const CATALOG_READY_PROMISE = 'Symbol.for("palamedes.document-catalogs-ready-promise")';
const CATALOG_READY = 'Symbol.for("palamedes.document-catalogs-ready")';
const MAX_SCRIPT_BUFFER_LENGTH = 256 * 1024;
const UNSAFE_SCRIPT_SOURCE_PATTERN = /[<>]|\p{Cc}/u;
const SOLID_PRODUCTION_ENTRY_PATTERN =
  /(?:^|\/)virtual[_-]solid-ssr-entry-client(?:-[^/?#]+)?\.(?:c|m)?js(?:[?#].*)?$/iu;
const SOLID_DEVELOPMENT_ENTRY_PATTERN =
  /(?:^|\/)(?:__x00__)?virtual:solid-ssr-entry-client\.(?:c|m)?tsx?(?:[?#].*)?$/iu;
const SOLID_AUTHORED_ENTRY_PATTERN =
  /(?:^|\/)entry-client(?:-[^/?#]+)?\.(?:c|m)?(?:jsx?|tsx?)(?:[?#].*)?$/iu;

/**
 * Connects Vite's active-locale import-map delivery to Solid's Fetch
 * middleware. The module entry is imported only after the initial catalog
 * readiness promise settles, so a failed catalog never mounts the app over
 * the host's catalog-free error document.
 */
export function createSolidCatalogDeliveryMiddleware(
  options: SolidCatalogDeliveryOptions,
): SolidFetchMiddleware {
  const development = options.development ?? isDevelopmentBuild();
  const delivery = createViteCatalogDelivery({
    clientDirectory: options.clientDirectory ?? path.resolve(process.cwd(), ".output/public"),
    development,
    ...(options.manifestName ? { manifestName: options.manifestName } : {}),
  });

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
            allowMissingPromise: development,
            nonce,
            trustedOrigins: binding ? trustedOriginsForBinding(binding.imports, request.url) : [],
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
  trustedOrigins: readonly string[];
}): Transform {
  const decoder = new StringDecoder("utf8");
  let mode: "text" | "opening-tag" | "gated-script" | "pass-through-script" = "text";
  let buffered = "";
  let scanOffset = 0;
  let tagQuote: "" | '"' | "'" = "";
  let gatedOpeningEnd = -1;
  let gatedModuleSource = "";
  let closeTagStart = -1;

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
    flush(callback: TransformCallback) {
      let output: string;
      try {
        buffered += decoder.end();
        output = flushMarkup(true);
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
        const moduleSource =
          readTagAttribute(openingTag, "type")?.toLowerCase() === "module"
            ? readTagAttribute(openingTag, "src")
            : undefined;
        if (
          moduleSource &&
          isTrustedSolidEntrySource(
            moduleSource,
            options.allowMissingPromise,
            options.trustedOrigins,
          )
        ) {
          mode = "gated-script";
          gatedOpeningEnd = openingEnd;
          gatedModuleSource = moduleSource;
          scanOffset = openingEnd + 1;
          closeTagStart = -1;
          continue;
        }
        // Inline and foreign scripts never need rewriting; stream their body
        // without buffering while still waiting for </script> so script text
        // cannot be mistaken for a nested HTML <script> tag.
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
          gatedModuleSource = "";
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
          gatedModuleSource = "";
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
          gatedModuleSource = "";
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
          gatedModuleSource = "";
        }
        break;
      }

      const gatedOpeningTag = buffered.slice(cursor, gatedOpeningEnd + 1);
      const unsupportedAttributes = (
        ["integrity", "crossorigin", "referrerpolicy"] as const
      ).filter((attribute) => readTagAttribute(gatedOpeningTag, attribute) !== undefined);
      if (unsupportedAttributes.length > 0) {
        throw new Error(
          `Cannot defer Solid entry ${gatedModuleSource} with unsupported fetch attributes: ${unsupportedAttributes.join(", ")}.`,
        );
      }
      const source = escapeScriptData(JSON.stringify(gatedModuleSource));
      const nonceValue = options.nonce ?? readTagAttribute(gatedOpeningTag, "nonce");
      const nonce = nonceValue ? ` nonce="${escapeAttribute(nonceValue)}"` : "";
      const importExpression = options.allowMissingPromise
        ? `(globalThis[${CATALOG_READY_PROMISE}] ? globalThis[${CATALOG_READY_PROMISE}].then(() => import(${source})) : import(${source}))`
        : `globalThis[${CATALOG_READY_PROMISE}].then(() => import(${source}))`;
      parts.push(
        `<script type="module"${nonce}>${importExpression}.catch((error) => { if (globalThis[${CATALOG_READY}]) throw error; globalThis.dispatchEvent(new CustomEvent("palamedes:catalogError", { detail: error })); });</script>`,
      );
      cursor = gatedCloseEnd.index + 1;
      mode = "text";
      gatedOpeningEnd = -1;
      gatedModuleSource = "";
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

function isTrustedSolidEntrySource(
  source: string,
  allowDevelopmentEntry: boolean,
  trustedOrigins: readonly string[],
): boolean {
  if (UNSAFE_SCRIPT_SOURCE_PATTERN.test(source)) return false;
  // Solid's generated entries are same-origin URLs by default. Absolute
  // custom bases are trusted only when Vite's generated catalog assets identify
  // the configured origin as part of this application.
  const isAbsolute = /^https?:\/\//iu.test(source);
  if ((!source.startsWith("/") || source.startsWith("//")) && !isAbsolute) return false;
  if (allowDevelopmentEntry) {
    if (!source.startsWith("/") || source.startsWith("//")) return false;
    return (
      SOLID_DEVELOPMENT_ENTRY_PATTERN.test(source) || SOLID_AUTHORED_ENTRY_PATTERN.test(source)
    );
  }
  const origin = isAbsolute ? urlOrigin(source) : undefined;
  const originAllowed = !isAbsolute || (origin !== undefined && trustedOrigins.includes(origin));
  return (
    originAllowed &&
    (SOLID_PRODUCTION_ENTRY_PATTERN.test(source) || SOLID_AUTHORED_ENTRY_PATTERN.test(source))
  );
}

function trustedOriginsForBinding(
  imports: Readonly<Record<string, string>>,
  requestUrl: string,
): readonly string[] {
  const origins = new Set<string>();
  try {
    origins.add(new URL(requestUrl).origin);
  } catch {
    // Request URLs are valid in the Fetch middleware; keep the fallback empty.
  }
  for (const asset of Object.values(imports)) {
    const origin = urlOrigin(asset);
    if (origin) origins.add(origin);
  }
  return [...origins];
}

function urlOrigin(value: string): string | undefined {
  try {
    const url = new URL(value, "https://palamedes.invalid");
    return /^https?:$/iu.test(url.protocol) && value.includes("://") ? url.origin : undefined;
  } catch {
    return undefined;
  }
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

function readTagAttribute(
  tag: string,
  name: "nonce" | "src" | "type" | "integrity" | "crossorigin" | "referrerpolicy",
): string | undefined {
  const scriptStart = tag.search(/<script\b/iu);
  if (scriptStart < 0) return undefined;
  let index = scriptStart + "<script".length;
  while (index < tag.length) {
    while (/\s/u.test(tag[index] ?? "")) index += 1;
    if (tag[index] === ">" || index >= tag.length) break;
    const nameStart = index;
    while (index < tag.length && !/[\s=/>]/u.test(tag[index] ?? "")) index += 1;
    if (index === nameStart) {
      index += 1;
      continue;
    }
    const attributeName = tag.slice(nameStart, index).toLowerCase();
    const afterName = index;
    while (/\s/u.test(tag[index] ?? "")) index += 1;
    if (tag[index] !== "=") {
      if (attributeName === name) return "";
      index = afterName;
      continue;
    }
    index += 1;
    while (/\s/u.test(tag[index] ?? "")) index += 1;
    const quote = tag[index] === '"' || tag[index] === "'" ? tag[index] : undefined;
    if (quote) index += 1;
    const valueStart = index;
    if (quote) {
      while (index < tag.length && tag[index] !== quote) index += 1;
    } else {
      while (index < tag.length && !/[\s>]/u.test(tag[index] ?? "")) index += 1;
    }
    if (attributeName === name) return tag.slice(valueStart, index);
    if (quote && tag[index] === quote) index += 1;
  }
  return undefined;
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function escapeScriptData(value: string): string {
  return value
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}
