# @palamedes/waku

Request-scoped i18n interceptor for Waku server actions.

## Installation

The adapter is **Stable**, verified with Waku `1.0.0-rc.4` and React, React DOM,
and `react-server-dom-webpack` `19.3.1`. Waku is an upstream release candidate,
and the adapter uses its `unstable_getRequest` and host CSP `unstable_setNonce`
APIs, so each new tested Waku version must pass the request, action, streaming,
catalog recovery, and CSP proofs before the peer range moves.
See the [stability policy](../../docs/stability.md#waku-contract).

```sh
pnpm add @palamedes/core @palamedes/runtime @palamedes/waku waku
```

`@palamedes/waku` is ESM-only, matching Waku's React Server Component runtime.
Use `import`; CommonJS `require()` is deliberately unsupported.

## Compiled catalog delivery

Keep catalog delivery in the server entry and leave locale selection in the
application. Use `createBundledServerI18n({ locale })` from
`@palamedes/runtime/server/bundled` to create a fresh instance backed by the shared,
lazily loaded compiled server catalog.
Do not import `.po` modules from browser-facing files or serialize catalog
functions through RSC.

For production builds, connect the generated active-locale import map to Waku's
document response with the server-only entry point. For request-rendered HTML
documents using a nonce-based CSP, generate a fresh cryptographic nonce per
request on the server, keep those responses out of shared caches, and share the
nonce across the response header, Palamedes catalog delivery, and Waku's
framework nonce (with Waku `1.0.0-rc.4`'s default Node adapter, prerendered
static pages are served by `serveStatic` before `middlewareFns` runs—bypassing
both the CSP middleware and `createWakuCatalogDeliveryMiddleware`, so routes
whose client chunks use split catalogs need request-time rendering or a separate
build-time catalog delivery step before computing a hash-based CSP at the static
host or edge proxy):

```ts
// src/lib/csp.server.ts
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";

type CspRequestState = { nonce: string; applied: boolean };
const cspNonceStorage = new AsyncLocalStorage<CspRequestState>();

export function runWithRequestNonce<T>(fn: () => T): T {
  return cspNonceStorage.run({ nonce: randomBytes(16).toString("base64"), applied: false }, fn);
}

export function getRequestNonce(): string | undefined {
  return cspNonceStorage.getStore()?.nonce;
}

export function markRequestNonceApplied(): void {
  const state = cspNonceStorage.getStore();
  if (state) state.applied = true;
}

export function wasRequestNonceApplied(): boolean {
  return cspNonceStorage.getStore()?.applied === true;
}
```

```ts
// src/waku.server.ts
import { fsRouter } from "waku";
import adapter from "waku/adapters/default";
import { createWakuCatalogDeliveryMiddleware } from "@palamedes/waku/server";
import { getRequestNonce, runWithRequestNonce, wasRequestNonceApplied } from "./lib/csp.server";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("/src/pages/**/*.{tsx,ts}")).map(([key, value]) => [
    key.slice("/src/".length),
    value,
  ]),
);

function buildAppCsp(nonce: string): string {
  // Keep one CSP owner per response: put all of your application's directives
  // (style-src, img-src, connect-src, etc.) here. If another middleware builds
  // Content-Security-Policy, read getRequestNonce() there so the header and
  // rendered scripts always share the exact same nonce.
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export default adapter(fsRouter(modules), {
  middlewareFns: [
    () => async (context, next) =>
      runWithRequestNonce(async () => {
        await next();
        const nonce = getRequestNonce();
        if (
          nonce &&
          wasRequestNonceApplied() &&
          context.res.headers.get("content-type")?.startsWith("text/html")
        ) {
          context.header("content-security-policy", buildAppCsp(nonce));
          // Nonce-bearing HTML must never be replayed across visitors by a shared cache.
          context.header("cache-control", "private, no-store");
        }
      }),
    () =>
      createWakuCatalogDeliveryMiddleware({
        resolveLocale: (request) => resolveApplicationLocale(request),
        nonce: () => (wasRequestNonceApplied() ? getRequestNonce() : undefined),
      }),
  ],
});
```

```ts
// src/pages/_interceptors/csp.server.ts
import { unstable_setNonce, type HandlerInterceptor } from "waku/router/server";
import { getRequestNonce, markRequestNonceApplied } from "../../lib/csp.server";

const cspInterceptor: HandlerInterceptor = async (next) => {
  const nonce = getRequestNonce();
  if (nonce) {
    unstable_setNonce(nonce);
    markRequestNonceApplied();
  }
  return await next();
};

export default cspInterceptor;
```

Because Waku's `fsRouter()` defaults pages to static rendering, opt routes that
rely on request-time catalog delivery and per-request CSP nonces into dynamic
rendering (as in `examples/waku-cookie/src/pages/_root.tsx` and `index.tsx`):

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
visitors. Note that in Waku `1.0.0-rc.4`'s default Node adapter, Waku's HTML fallback
shell (served for an unmatched `/` route or a handler returning `"fallback"`)
renders outside router handler interceptors and therefore receives no
`unstable_setNonce` value (ordinary unmatched non-root URLs without a custom
`404` page return plain-text `404 Not Found` with no bootstrap script); define a
request-rendered `/` route through the router (or serve the fallback shell with
its own CSP) so the nonce policy does not block fallback startup. Do not derive a CSP nonce from an
arbitrary client-supplied request header such as `x-csp-nonce`: an attacker
could supply a predictable value and bypass the script policy. See the
[deployment security guide](../../docs/security.md#csp-nonces-and-script-delivery).

The middleware transforms HTML document streams after Waku renders them. RSC
and action responses pass through unchanged. If an active fragment cannot be
loaded before hydration, it presents a catalog-free reload/home document and
does not expose internal module diagnostics. The middleware accepts no locale
policy; `resolveLocale` remains the host application's responsibility.
`clientDirectory` defaults to `dist/public` in the process working directory,
and `manifestName` overrides the generated manifest filename. `development`
defaults to how Vite built the server (`import.meta.env.DEV`), not to the
runtime `NODE_ENV`, so a production build delivers its import map even when the
server starts without `NODE_ENV`. Pass it only to override that default. The `nonce`
option is a string or `(request, context) => string | undefined`, called once
per HTML document, and applies only to Palamedes-generated import-map and
readiness scripts. Set Waku's framework nonce with `unstable_setNonce` from
`waku/router/server` in the host request interceptor before rendering. Existing
framework nonces are preserved; application and external scripts are never
automatically authorized. Configure the host CSP for the selected nonce and
its permitted module origins. Lazy client
component failures after hydration remain ordinary React error-boundary
failures, so the host can provide its normal recovery UI.

## Waku handler interceptor

Create one interceptor under `src/pages/_interceptors/`. `fsRouter()` discovers this
directory automatically. The resolver receives Waku's original Fetch request,
so it can read headers and cookies to negotiate a locale and load its catalog.
It must return a fresh activated i18n instance for each request.

```ts
// src/pages/_interceptors/palamedes.server.ts
import { createWakuI18nInterceptor } from "@palamedes/waku";
import { createRequestI18n } from "../../lib/i18n.server";

export default createWakuI18nInterceptor(async (request) => {
  return await createRequestI18n(request);
});
```

This is opt-in. Existing Waku applications do not change until an interceptor
is registered. Waku invokes the interceptor before it invokes `"use server"`
actions, including default-parameter evaluation. It keeps the scope active for
the full awaited action, including synchronous, asynchronous, and cross-module
helpers that use transformed Palamedes macros.

Waku runs interceptors inside its request store for requests and static
builds. If its unstable request accessor still throws, the interceptor throws
an error beginning `Palamedes Waku i18n interceptor could not read the Waku
request` before the handler runs, with Waku's error as `cause`. This usually
means `@palamedes/waku` loaded a separate copy of `waku/router/server`; the
Palamedes Vite plugin keeps the adapter in Vite's server module graph to avoid
that. The check does not depend on the wording or shape of Waku's error.

Initializer or catalog failures prevent the action body from running and throw
an error beginning `Palamedes Waku i18n initialization failed`; pass
`{ failureMessage }` as the interceptor's second argument to change it. Waku's default
production handler returns its generic 500 response for uncaught errors; keep
server logs available to retain the error cause.

## Streaming and runtime limits

The interceptor restores the caller's scope when Waku's awaited handler promise
settles and returns its `Response`, before that response body is consumed.
Waku creates the response `ReadableStream` inside the i18n scope, so Node's
`AsyncLocalStorage` can retain the active locale in stream callbacks created by
the handler while they are consumed later. Those callbacks do not extend the
caller's request ownership.

`@palamedes/waku` uses `@palamedes/runtime/server`, which requires Node's
`AsyncLocalStorage`. It supports the pinned Waku line `^1.0.0-rc.4` on
Node.js 24.3.0 or later. Do not use this adapter in Edge or Worker runtimes
unless their Node-compatible `AsyncLocalStorage` behavior has been independently
verified. Waku's request and nonce APIs are unstable-prefixed,
so treat the adapter as coupled to that Waku line and revalidate it when
upgrading Waku.

Do not use detached work as request ownership. Work started during an action
may inherit Node's async context after the response, while work started later
will not; pass explicit locale data to background work instead.

### Middleware ordering

With Waku's default adapter, adapter middleware runs before router dispatch and
the Palamedes handler interceptor. Middleware that prepares the request for
locale negotiation must `await next()`; middleware that returns a response
early does not enter the i18n scope. Do not install a competing Palamedes
server scope around this interceptor.

<!-- ferramenta-family:start -->

**palamedes** is part of the [Ferramenta](https://ferramenta.dev) family — A family of Rust tools.

Siblings: [ferroni](https://sebastian-software.github.io/ferroni/) — Oniguruma-compatible regex engine · [ferriki](https://github.com/sebastian-software/ferriki) — Shiki-compatible syntax highlighting · [ferromark](https://sebastian-software.github.io/ferromark/) — Markdown to HTML with a secure default and every GFM extension included. · [ferrolex](https://github.com/sebastian-software/ferrolex) — Spell checking for text and code · [ferrocat](https://ferrocat.dev) — Translation catalog engine · [ferrovia](https://github.com/sebastian-software/ferrovia) — SVGO-compatible SVG optimizer · [ferralk](https://github.com/sebastian-software/ferralk) — Glob matching and parallel filesystem walking · [ferrugo](https://github.com/sebastian-software/ferrugo) — PDF previews for untrusted files.
<!-- ferramenta-family:end -->

## License

MIT OR Apache-2.0 © 2026 Sebastian Software
