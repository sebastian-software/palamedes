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
  /** CSP nonce for Palamedes-generated import maps and bootstrap scripts. */
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
  let tail = "";

  return new Transform({
    transform(chunk: unknown, _encoding: BufferEncoding, callback: TransformCallback) {
      try {
        tail += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
        flushSafePrefix(this, false);
        callback();
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)));
      }
    },
    flush(callback: TransformCallback) {
      try {
        tail += decoder.end();
        flushSafePrefix(this, true);
        callback();
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)));
      }
    },
  });

  function flushSafePrefix(stream: Transform, flush: boolean) {
    while (true) {
      const match = SCRIPT_BLOCK_PATTERN.exec(tail);
      if (match) {
        const end = match.index + match[0].length;
        if (!flush && end > tail.length - TAIL_SIZE) break;
        const script = match[0];
        const openingTag = script.slice(0, findTagEnd(script) + 1);
        const moduleSource =
          readTagAttribute(openingTag, "type")?.toLowerCase() === "module"
            ? readTagAttribute(openingTag, "src")
            : undefined;
        let replacement = script;
        if (
          moduleSource &&
          isTrustedSolidEntrySource(
            moduleSource,
            options.allowMissingPromise,
            options.trustedOrigins,
          )
        ) {
          const unsupportedAttributes = ["integrity", "crossorigin", "referrerpolicy"].filter(
            (attribute) => readTagAttribute(openingTag, attribute) !== undefined,
          );
          if (unsupportedAttributes.length > 0) {
            throw new Error(
              `Cannot defer Solid entry ${moduleSource} with unsupported fetch attributes: ${unsupportedAttributes.join(", ")}.`,
            );
          }
          const source = JSON.stringify(moduleSource);
          const nonceValue = options.nonce ?? readCspNonce(script);
          const nonce = nonceValue ? ` nonce="${escapeAttribute(nonceValue)}"` : "";
          const importExpression = options.allowMissingPromise
            ? `(globalThis[${CATALOG_READY_PROMISE}] ? globalThis[${CATALOG_READY_PROMISE}].then(() => import(${source})) : import(${source}))`
            : `globalThis[${CATALOG_READY_PROMISE}].then(() => import(${source}))`;
          replacement = `<script type="module"${nonce}>${importExpression}.catch((error) => { if (globalThis[${CATALOG_READY}]) throw error; globalThis.dispatchEvent(new CustomEvent("palamedes:catalogError", { detail: error })); });</script>`;
        }
        stream.push(tail.slice(0, match.index) + replacement);
        tail = tail.slice(end);
        continue;
      }
      if (flush) {
        if (tail) stream.push(tail);
        tail = "";
      } else {
        const scriptStart = lastScriptStart(tail);
        const safeEnd = tail.length - TAIL_SIZE;
        if (safeEnd <= 0) return;
        // Keep every possible script block intact. A block can be much longer
        // than TAIL_SIZE (for example Solid's inline hydration payload), and
        // flushing at safeEnd would make the second half impossible to parse.
        if (scriptStart >= 0) {
          stream.push(tail.slice(0, scriptStart));
          tail = tail.slice(scriptStart);
        } else {
          const cut = safeTextCut(tail, safeEnd);
          stream.push(tail.slice(0, cut));
          tail = tail.slice(cut);
        }
      }
      return;
    }
  }
}

function isTrustedSolidEntrySource(
  source: string,
  allowDevelopmentEntry: boolean,
  trustedOrigins: readonly string[],
): boolean {
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

function findTagEnd(value: string): number {
  let quote: '"' | "'" | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote) quote = undefined;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return value.length - 1;
}

function readTagAttribute(
  tag: string,
  name: "nonce" | "src" | "type" | "integrity" | "crossorigin" | "referrerpolicy",
): string | undefined {
  let index = tag.indexOf("<script") + "<script".length;
  while (index >= "<script".length && index < tag.length) {
    while (/\s/u.test(tag[index] ?? "")) index += 1;
    if (tag[index] === ">" || index >= tag.length) break;
    const nameStart = index;
    while (index < tag.length && !/[\s=/>]/u.test(tag[index] ?? "")) index += 1;
    const attributeName = tag.slice(nameStart, index).toLowerCase();
    while (/\s/u.test(tag[index] ?? "")) index += 1;
    if (tag[index] !== "=") {
      if (attributeName === name) return "";
      while (index < tag.length && !/[\s>]/u.test(tag[index] ?? "")) index += 1;
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

function readCspNonce(script: string): string | undefined {
  return readTagAttribute(script.slice(0, findTagEnd(script) + 1), "nonce");
}

function lastScriptStart(value: string): number {
  const matches = [...value.matchAll(/<script\b/giu)];
  if (matches.length > 0) return matches.at(-1)?.index ?? -1;

  // Retain a partial opener split over two byte chunks. The normal tail
  // retention keeps this small suffix until the next chunk arrives.
  const lower = value.toLowerCase();
  const opener = "<script";
  for (let size = opener.length - 1; size > 0; size -= 1) {
    if (lower.endsWith(opener.slice(0, size))) return value.length - size;
  }
  return -1;
}

function safeTextCut(value: string, desired: number): number {
  let cut = desired;
  if (cut > 0 && cut < value.length) {
    const previous = value.charCodeAt(cut - 1);
    const next = value.charCodeAt(cut);
    if (previous >= 0xd8_00 && previous <= 0xdb_ff && next >= 0xdc_00 && next <= 0xdf_ff) {
      cut -= 1;
    }
  }
  return cut;
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}
