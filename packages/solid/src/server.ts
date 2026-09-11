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
  /** CSP nonce for generated and Solid inline bootstrap scripts. */
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
const SOLID_AUTHORED_ENTRY_PATTERN = /(?:^|\/)entry-client\.(?:c|m)?(?:jsx?|tsx?)(?:[?#].*)?$/iu;

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
            trustedChunkKeys: binding ? Object.keys(binding.chunkImports) : [],
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
  trustedChunkKeys: readonly string[];
}): Transform {
  const decoder = new StringDecoder("utf8");
  let tail = "";

  return new Transform({
    transform(chunk: unknown, _encoding: BufferEncoding, callback: TransformCallback) {
      tail += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
      flushSafePrefix(this, false);
      callback();
    },
    flush(callback: TransformCallback) {
      tail += decoder.end();
      flushSafePrefix(this, true);
      callback();
    },
  });

  function flushSafePrefix(stream: Transform, flush: boolean) {
    while (true) {
      const match = SCRIPT_BLOCK_PATTERN.exec(tail);
      if (match) {
        const end = match.index + match[0].length;
        if (!flush && end > tail.length - TAIL_SIZE) break;
        const script = match[0];
        const moduleSource = script.match(
          /\btype\s*=\s*["']module["'][^>]*\bsrc\s*=\s*["']([^"']+)["']|\bsrc\s*=\s*["']([^"']+)["'][^>]*\btype\s*=\s*["']module["']/iu,
        );
        let replacement = script;
        if (
          moduleSource &&
          isTrustedSolidEntrySource(
            moduleSource[1] ?? moduleSource[2],
            options.trustedChunkKeys,
            options.allowMissingPromise,
          )
        ) {
          const source = JSON.stringify(moduleSource[1] ?? moduleSource[2]);
          const nonceValue = options.nonce ?? readCspNonce(script);
          const nonce = nonceValue ? ` nonce="${escapeAttribute(nonceValue)}"` : "";
          const importExpression = options.allowMissingPromise
            ? `(globalThis[${CATALOG_READY_PROMISE}] ? globalThis[${CATALOG_READY_PROMISE}].then(() => import(${source})) : import(${source}))`
            : `globalThis[${CATALOG_READY_PROMISE}].then(() => import(${source}))`;
          replacement = `<script type="module"${nonce}>${importExpression}.catch((error) => { if (globalThis[${CATALOG_READY}]) throw error; });</script>`;
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
  trustedChunkKeys: readonly string[],
  allowDevelopmentEntry: boolean,
): boolean {
  // Solid's generated entries are same-origin URLs. Do not gate arbitrary
  // application or third-party modules merely because they are module tags.
  if (!source.startsWith("/") || source.startsWith("//")) return false;
  if (allowDevelopmentEntry) {
    return (
      SOLID_DEVELOPMENT_ENTRY_PATTERN.test(source) || SOLID_AUTHORED_ENTRY_PATTERN.test(source)
    );
  }
  const key = assetKey(source);
  return (
    SOLID_PRODUCTION_ENTRY_PATTERN.test(source) ||
    (trustedChunkKeys.includes(key) && SOLID_AUTHORED_ENTRY_PATTERN.test(source))
  );
}

function assetKey(href: string): string {
  let pathname = href;
  try {
    pathname = new URL(href, "https://palamedes.invalid").pathname;
  } catch {
    // Preserve malformed but useful Vite URLs for the manifest lookup below.
  }
  const assets = pathname.indexOf("assets/");
  return (assets !== -1 ? pathname.slice(assets) : pathname).replace(/^\/+/, "");
}

function readCspNonce(script: string): string | undefined {
  return script.match(/\bnonce\s*=\s*["']([^"']*)["']/iu)?.[1];
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
