# `@palamedes/waku`

`@palamedes/waku` activates a fresh request-local i18n instance around Waku
handlers, including `"use server"` actions. It is opt-in: existing Waku
applications do not change until an interceptor is registered.

The adapter is **Stable**, verified with Waku `1.0.0-rc.4` and React, React DOM,
and `react-server-dom-webpack` `19.3.1`. Waku is an upstream release candidate,
and the adapter uses its `unstable_getRequest` and host CSP `unstable_setNonce`
APIs, so each new tested Waku version must pass the request, action, streaming,
catalog recovery, and CSP proofs before the peer range moves.
See the [stability policy](../stability.md#waku-contract).

## Installation

```sh
pnpm add @palamedes/core @palamedes/runtime @palamedes/waku waku
```

The adapter supports `waku@^1.0.0-rc.4` and Node.js 24.3.0 or newer. Register the Palamedes Vite plugin for macro transformation and generated catalog
delivery; application-owned catalog imports or loader maps are unnecessary.
`@palamedes/waku` is ESM-only: use `import`; CommonJS `require()` is deliberately
unsupported.

## Compiled catalog delivery

Keep the server catalog loader and the browser catalog delivery in the server
entry. The Vite plugin emits immutable native catalog modules for the active
locale and a shared server catalog store; it does not require importing `.po`
files from an RSC or browser module.

```ts
// src/lib/i18n.server.ts
import { createBundledServerI18n } from "@palamedes/runtime/server/bundled";
import { locales } from "./i18n";

export function resolveApplicationLocale(request: Request) {
  return locales.resolve({
    strategy: "cookie",
    acceptLanguageHeader: request.headers.get("accept-language"),
    cookieHeader: request.headers.get("cookie"),
  }).locale;
}

export function createRequestI18n(request: Request) {
  return createBundledServerI18n({ locale: resolveApplicationLocale(request) });
}
```

For document responses, install the Waku middleware after Waku has rendered the
response. It injects only the active locale's generated catalog modules and
gates Waku's client entry on their evaluation. `resolveLocale` remains the
application's host, path, cookie, or header policy; the middleware does not
maintain a second locale map. For request-rendered HTML documents using a
nonce-based CSP, generate a fresh cryptographic nonce per request on the server,
keep those responses out of shared caches, and share the nonce between the
response header, Palamedes catalog delivery, and Waku's `unstable_setNonce`
interceptor (with Waku `1.0.0-rc.4`'s default Node adapter, prerendered static
pages are served by `serveStatic` before `middlewareFns` runs—bypassing both
the CSP middleware and `createWakuCatalogDeliveryMiddleware`, so routes whose
client chunks use split catalogs need request-time rendering or a separate
build-time catalog delivery step before computing a hash-based CSP at the static
host or edge proxy):

```ts
// src/lib/csp.server.ts
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";

type CspRequestState = { nonce: string; ssrHtml: boolean };
const cspNonceStorage = new AsyncLocalStorage<CspRequestState>();

export function runWithRequestNonce<T>(fn: () => T): T {
  return cspNonceStorage.run({ nonce: randomBytes(16).toString("base64"), ssrHtml: false }, fn);
}

export function getRequestNonce(): string | undefined {
  return cspNonceStorage.getStore()?.nonce;
}

export function markSsrHtmlResponse(): void {
  const state = cspNonceStorage.getStore();
  if (state) state.ssrHtml = true;
}

export function isSsrHtmlResponse(): boolean {
  return cspNonceStorage.getStore()?.ssrHtml === true;
}
```

```ts
// src/waku.server.ts
import { fsRouter } from "waku";
import adapter from "waku/adapters/default";
import { createWakuCatalogDeliveryMiddleware } from "@palamedes/waku/server";
import { getRequestNonce, isSsrHtmlResponse, runWithRequestNonce } from "./lib/csp.server";
import { resolveApplicationLocale } from "./lib/i18n.server";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("/src/pages/**/*.{js,ts,tsx,jsx,mjs,cjs}")).map(
    ([key, value]) => [key.slice("/src/".length), value],
  ),
);

function buildAppCsp(nonce: string): string {
  // Nonce-enabled same-origin policy: `script-src 'self'` assumes all same-origin
  // script URLs are trusted (do not host untrusted user-uploaded scripts on this
  // origin). Keep one CSP owner per response: either add your other directives
  // (style-src, img-src, connect-src, etc.) here, or remove the
  // `content-security-policy` write below when an existing `src/middleware/*`
  // handler builds CSP with `getRequestNonce()`.
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const catalogDelivery = createWakuCatalogDeliveryMiddleware({
  resolveLocale: (request) => resolveApplicationLocale(request),
  nonce: () => (!import.meta.env.DEV ? getRequestNonce() : undefined),
});

export default adapter(fsRouter(modules), {
  // Preserve Waku's managed `src/middleware/*` discovery when adding a custom server entry.
  middlewareModules: import.meta.glob([
    "/src/middleware/*.{js,ts,tsx,jsx,mjs,cjs}",
    "!/src/middleware/*.{test,spec}.{js,ts,tsx,jsx,mjs,cjs}",
  ]),
  middlewareFns: [
    () => async (context, next) =>
      runWithRequestNonce(async () => {
        await next();
        const nonce = getRequestNonce();
        // Apply this nonce-enabled same-origin policy in production builds;
        // Vite dev injects HMR scripts and inline styles that need a separate dev policy.
        if (
          !import.meta.env.DEV &&
          nonce &&
          isSsrHtmlResponse() &&
          context.res.headers.get("content-type")?.startsWith("text/html")
        ) {
          // Omit this write if an existing `src/middleware/*` handler already sets
          // Content-Security-Policy using `getRequestNonce()`; otherwise this runs
          // after `middlewareModules` and replaces that header. Always keep Cache-Control.
          context.header("content-security-policy", buildAppCsp(nonce));
          // Nonce-bearing HTML must never be replayed across visitors by a shared cache.
          context.header("cache-control", "private, no-store");
        }
      }),
    () => async (context, next) => {
      await next();
      // Transform only Waku-rendered SSR HTML so raw HTML `_api` handlers keep
      // their own response body and CSP without unnonced catalog tags injected.
      if (isSsrHtmlResponse()) {
        await catalogDelivery(context, async () => {});
      }
    },
  ],
});
```

```ts
// src/pages/_interceptors/csp.server.ts
import {
  unstable_getRscPath,
  unstable_setNonce,
  type HandlerInterceptor,
} from "waku/router/server";
import { getRequestNonce, markSsrHtmlResponse } from "../../lib/csp.server";

const cspInterceptor: HandlerInterceptor = async (next) => {
  const nonce = getRequestNonce();
  if (!import.meta.env.DEV && nonce) unstable_setNonce(nonce);
  const result = await next();
  // This recipe covers SSR-enabled dynamic pages: Waku sets an RSC path for SSR
  // pages, leaves it unset for `_api` handlers (so raw HTML handlers stay
  // untouched under their own CSP), and returns null for unmatched `/` before
  // its unnonced root fallback shell runs. `unstable_disableSSR: true` routes
  // are outside scope.
  if (
    unstable_getRscPath() !== undefined &&
    result instanceof Response &&
    result.headers.get("content-type")?.startsWith("text/html")
  ) {
    markSsrHtmlResponse();
  }
  return result;
};

export default cspInterceptor;
```

Because Waku's `fsRouter()` defaults pages to static rendering, opt SSR routes
that rely on request-time catalog delivery and per-request CSP nonces into
dynamic rendering (as in `examples/waku-cookie/src/pages/_root.tsx` and
`index.tsx`). This recipe is scoped to SSR-enabled dynamic routes; routes using
`unstable_disableSSR: true` are outside its scope (Waku `1.0.0-rc.4`'s default
non-SSR shell omits `</head>` and does not receive the split-catalog import map):

```ts
export async function getConfig() {
  return {
    render: "dynamic",
  } as const;
}
```

Always generate the nonce per request on the server (or strip and regenerate it
in a trusted edge proxy), and ensure any CDN or reverse proxy respects
`Cache-Control: private, no-store` so nonce-bearing HTML is never cached across
visitors. Note that in Waku `1.0.0-rc.4`'s default Node adapter, Waku's default
HTML fallback shell (served for an unmatched `/` route or a handler returning
`"fallback"`) renders outside router handler interceptors without
`unstable_setNonce` and omits `</head>`, so it receives neither the nonce CSP
nor Palamedes's split-catalog import map (ordinary unmatched non-root URLs
without a custom `404` page return plain-text `404 Not Found` with no bootstrap
script); always define a request-rendered `/` route through the router for
applications using split catalogs (or serve a custom fallback with full HTML
catalog delivery and its own CSP). Do not derive a CSP nonce from an arbitrary
client-supplied request header such as `x-csp-nonce`: an attacker could supply a
predictable value and bypass the script policy. See the
[deployment security guide](../security.md#csp-nonces-and-script-delivery).

`clientDirectory` points at the Vite client build containing
`palamedes-split-manifest.json`; it defaults to Waku's `dist/public` in the
process working directory. `development` defaults to how Vite built the server
(`import.meta.env.DEV`): `true` under `waku dev`, `false` in the output of
`waku build`. The runtime `NODE_ENV` does not change it, so a custom server that
starts a production build without `NODE_ENV` still delivers the import map. In
development the adapter reads no manifest; pass `development` to override the
default. Pass `manifestName` for a custom Vite output. The
`nonce` option is a string or `(request, context) => string | undefined`,
called once per HTML document with the middleware context. These names and
shapes match the React Router, TanStack, and Solid adapters. If an active fragment cannot be fetched or
evaluated, the middleware renders its catalog-free reload document and keeps
the diagnostic out of the response. Set `errorHtml` to provide a trusted host
recovery document. The `nonce` option applies only to Palamedes-generated
import-map and readiness scripts. Set Waku's framework nonce with
`unstable_setNonce` from `waku/router/server` in a request interceptor before
rendering. Existing framework nonces are preserved; application and external
scripts are never automatically authorized. Allow the nonce and permitted
module origins in the host CSP. RSC and action responses pass through unchanged.

## Interceptor registration

When using Waku's `fsRouter()`, add a default export below
`src/pages/_interceptors/`. Waku discovers these modules and wraps its handlers with
the interceptor.

```ts
// src/pages/_interceptors/palamedes.server.ts
import { createWakuI18nInterceptor } from "@palamedes/waku";
import { createRequestI18n } from "../../lib/i18n.server";

export default createWakuI18nInterceptor(async (request) => {
  return await createRequestI18n(request);
});
```

The resolver receives Waku's original Fetch `Request`, including headers and
cookies. It resolves the application locale and delegates catalog loading and
instance creation to `createBundledServerI18n`; the interceptor owns activation
and cleanup. If it fails, the action
body does not run and the server throws an error beginning `Palamedes Waku i18n
initialization failed` with the original cause attached. Pass
`createWakuI18nInterceptor(resolveI18n, { failureMessage })` to change that
message.

The interceptor has no `i18nOptions`: the application's resolver creates the
instance through `createBundledServerI18n({ locale, timeZone })`, so formatting
options are already part of that call.

Waku enters the handler interceptor before its action dispatcher invokes
`fn(...args)`. The scope therefore begins before action default-parameter
evaluation and remains active through the full awaited action, including direct
macros and synchronous, asynchronous, or cross-module helper calls.

Waku runs handler interceptors inside its router request store for requests
and static builds. If Waku's unstable request accessor still throws, the
interceptor throws an error beginning `Palamedes Waku i18n interceptor could
not read the Waku request` before the handler runs, with the accessor error as
`cause`. This usually means the adapter loaded a separate copy of
`waku/router/server`. Register `palamedes()` from `@palamedes/vite-plugin`,
which keeps `@palamedes/waku` in Vite's server module graph, and register the
interceptor through Waku's router. The check does not inspect the unstable
error's message or shape.

## Streaming and runtime limits

The caller's scope is restored when the awaited handler promise settles and
returns the `Response`, before the body is consumed. Waku creates the response
`ReadableStream` inside the interceptor scope, so Node's `AsyncLocalStorage`
can retain the active locale in stream callbacks created by the handler while
they are consumed later. Those callbacks do not extend the caller's request
ownership.
Do not use detached work as request ownership: work created during an action
may inherit its async context after the response, while later work will not.
Pass locale data explicitly to background work.

The adapter relies on `@palamedes/runtime/server` and Node's
`AsyncLocalStorage`. Edge and Worker runtimes are unsupported unless their
Node-compatible `AsyncLocalStorage` behavior is independently verified. Waku's
request and nonce APIs are unstable-prefixed; revalidate this adapter when
upgrading Waku.

## Middleware ordering

Waku default-adapter middleware runs before router dispatch and the Palamedes
handler interceptor. Middleware that prepares locale inputs must `await next()`;
an early response never enters the i18n scope. Do not install a competing
Palamedes server scope around this interceptor.
