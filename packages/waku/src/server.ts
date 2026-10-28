import path from "node:path";
import { Transform } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { createViteCatalogDelivery } from "@palamedes/vite-plugin/delivery";

/**
 * The part of the middleware context this adapter reads and writes. Waku
 * registers `middlewareFns` handlers on its Hono app, and Hono's context is
 * structurally compatible with this shape, so the adapter needs no Hono
 * dependency of its own.
 */
export type WakuMiddlewareContext = {
  readonly req: { readonly raw: Request };
  res: Response;
};

/** A handler that Waku's `middlewareFns` factories can return. */
export type WakuMiddlewareHandler = (
  context: WakuMiddlewareContext,
  next: () => Promise<void>,
) => Promise<void>;

/** Resolves a document request's CSP nonce, for example from the middleware context. */
export type WakuNonceResolver = (
  request: Request,
  context: WakuMiddlewareContext,
) => string | undefined;

export type WakuCatalogDeliveryOptions = {
  /**
   * Built Vite client directory containing palamedes-split-manifest.json.
   * Defaults to Waku's `dist/public` in the process working directory.
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
  /** Optional trusted catalog-free host UI for failed delivery. */
  errorHtml?: string;
  /**
   * CSP nonce for the generated import map and failure probe: a fixed string,
   * or a resolver called once per HTML document request.
   */
  nonce?: string | WakuNonceResolver;
};

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

/**
 * Connects Vite's active-locale import-map delivery to Waku's HTML response.
 * Locale selection remains application-owned; this middleware only transforms
 * document responses after Waku has rendered them and leaves RSC/action
 * responses untouched.
 */
export function createWakuCatalogDeliveryMiddleware(
  options: WakuCatalogDeliveryOptions,
): WakuMiddlewareHandler {
  const development = options.development ?? isDevelopmentBuild();
  const delivery = createViteCatalogDelivery({
    clientDirectory: options.clientDirectory ?? path.resolve(process.cwd(), "dist/public"),
    development,
    ...(options.manifestName ? { manifestName: options.manifestName } : {}),
  });

  return async (context, next) => {
    await next();
    const response = context.res;
    if (!response.body || !response.headers.get("content-type")?.startsWith("text/html")) {
      return;
    }

    const binding = delivery.getLocaleBinding(options.resolveLocale(context.req.raw));
    const nonce =
      typeof options.nonce === "function" ? options.nonce(context.req.raw, context) : options.nonce;
    const body = response.body
      .pipeThrough(
        webTransform(
          delivery.createDocumentTransform(binding, {
            ...(options.errorHtml ? { errorHtml: options.errorHtml } : {}),
            ...(nonce ? { nonce } : {}),
          }),
        ),
      )
      .pipeThrough(
        webTransform(
          createWakuBootstrapGateTransform({
            allowMissingPromise: development,
            failOnDrift: development,
          }),
        ),
      );
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    context.res = new Response(body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  };
}

// Node and DOM stream declarations differ across the supported TypeScript majors.
function webTransform(transform: Transform): ReadableWritablePair<Uint8Array, Uint8Array> {
  return Transform.toWeb(transform) as unknown as ReadableWritablePair<Uint8Array, Uint8Array>;
}

const CATALOG_READY_PROMISE = 'Symbol.for("palamedes.document-catalogs-ready-promise")';
const CATALOG_READY = 'Symbol.for("palamedes.document-catalogs-ready")';
const WAKU_ENTRY_PATTERN =
  /import\(((['"])(?:https?:\/\/[^"']+)?\/(?:[^"']*\/)?index-[^"']+\.js\2)\)/u;
const TAIL_SIZE = 192;

let driftWarned = false;

const DRIFT_MESSAGE =
  'Palamedes could not find the entry import in Waku\'s inline bootstrap script (<script id="_R_">), ' +
  "so the catalog readiness gate was not applied and Waku may hydrate over a failed catalog. " +
  "The installed Waku version probably changed its bootstrap output; check that @palamedes/waku supports it.";

/**
 * The bootstrap gate is a textual rewrite of upstream output. When the Waku
 * bootstrap is present but the entry import was not rewritten, the gate is
 * silently off. Development fails the response; production keeps serving the
 * page and logs one warning per process.
 */
function reportBootstrapDrift(failOnDrift: boolean): Error | undefined {
  if (failOnDrift) return new Error(DRIFT_MESSAGE);
  if (!driftWarned) {
    driftWarned = true;
    console.warn(`[palamedes] ${DRIFT_MESSAGE}`);
  }
  return undefined;
}

/**
 * Waku emits an inline entry bootstrap after the document head. Gate that
 * import on the exact same catalog-import promise used by the delivery probe.
 * This keeps Waku from mounting over the host error document when an initial
 * fragment fails, without timing delays or app-owned DOM handling.
 */
function createWakuBootstrapGateTransform(options: {
  allowMissingPromise: boolean;
  failOnDrift: boolean;
}): Transform {
  const decoder = new StringDecoder("utf8");
  let tail = "";
  let driftError: Error | undefined;

  function gateWakuEntry(value: string): string {
    const importExpression = (source: string) =>
      options.allowMissingPromise
        ? `(globalThis[${CATALOG_READY_PROMISE}] ? globalThis[${CATALOG_READY_PROMISE}].then(() => import(${source})) : import(${source}))`
        : `globalThis[${CATALOG_READY_PROMISE}].then(() => import(${source}))`;
    let entryRewrites = 0;
    const gated = value
      .replace(
        /if \(!canRetry\) \{\s*return;\s*\}/u,
        `if (globalThis[${CATALOG_READY}] || !globalThis[${CATALOG_READY_PROMISE}]) {\nreturn;\n}\ne.preventDefault();\nreturn;`,
      )
      .replace(WAKU_ENTRY_PATTERN, (_match: string, source: string) => {
        entryRewrites += 1;
        return importExpression(source);
      });
    if (entryRewrites === 0) driftError ??= reportBootstrapDrift(options.failOnDrift);
    return gated;
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
      callback(driftError);
    },
  });

  function flushSafePrefix(stream: Transform, flush: boolean) {
    while (tail) {
      const open = /<script\b/iu.exec(tail);
      if (!open) {
        const safeEnd = flush
          ? tail.length
          : unicodeCut(tail, Math.max(0, tail.length - TAIL_SIZE));
        if (safeEnd > 0) stream.push(tail.slice(0, safeEnd));
        tail = tail.slice(safeEnd);
        return;
      }
      const openingEnd = scriptTagEnd(tail, open.index);
      const close = openingEnd < 0 ? null : /<\/script\s*>/iu.exec(tail.slice(openingEnd + 1));
      if (openingEnd < 0 || !close) {
        const safeEnd = flush ? tail.length : open.index;
        if (safeEnd > 0) stream.push(tail.slice(0, safeEnd));
        tail = tail.slice(safeEnd);
        return;
      }
      const end = openingEnd + 1 + close.index + close[0].length;
      const openingTag = tail.slice(open.index, openingEnd + 1);
      const script = tail.slice(open.index, end);
      // Waku/React own this bootstrap. Do not rewrite imports or retry-like
      // text in application scripts, rendered content, or Flight payloads.
      const frameworkBootstrap =
        /\sid\s*=\s*(["'])_R_\1/iu.test(openingTag) && !/\ssrc\s*=/iu.test(openingTag);
      stream.push(
        tail.slice(0, open.index) + (frameworkBootstrap ? gateWakuEntry(script) : script),
      );
      tail = tail.slice(end);
    }
  }
}

function scriptTagEnd(source: string, start: number): number {
  let quote = "";
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
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

function unicodeCut(value: string, end: number): number {
  const before = value.charCodeAt(end - 1);
  const after = value.charCodeAt(end);
  return before >= 0xd8_00 && before <= 0xdb_ff && after >= 0xdc_00 && after <= 0xdf_ff
    ? end - 1
    : end;
}
