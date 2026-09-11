# @palamedes/waku

Request-scoped i18n interceptor for Waku server actions.

## Installation

```sh
pnpm add @palamedes/core @palamedes/runtime @palamedes/waku waku
```

`@palamedes/waku` is ESM-only, matching Waku's React Server Component runtime.
Use `import`; CommonJS `require()` is deliberately unsupported.

## Compiled catalog delivery

Keep catalog delivery in the server entry and leave locale selection in the
application. Use `createViteServerI18n({ locale })` from
`@palamedes/vite-plugin/server` to create a fresh instance backed by the shared,
lazily loaded compiled server catalog.
Do not import `.po` modules from browser-facing files or serialize catalog
functions through RSC.

For production builds, connect the generated active-locale import map to Waku's
document response with the server-only entry point:

```ts
import { createWakuCatalogDeliveryMiddleware } from "@palamedes/waku/server";

middlewareFns: [
  () =>
    createWakuCatalogDeliveryMiddleware({
      clientDirectory: "dist/public",
      resolveLocale: (request) => resolveApplicationLocale(request),
      development: process.env.NODE_ENV !== "production",
      nonce: (request) => request.headers.get("x-csp-nonce") ?? undefined,
    }),
];
```

The middleware transforms HTML document streams after Waku renders them. RSC
and action responses pass through unchanged. If an active fragment cannot be
loaded before hydration, it presents a catalog-free reload/home document and
does not expose internal module diagnostics. The middleware accepts no locale
policy; `resolveLocale` remains the host application's responsibility. The `nonce` option applies only to Palamedes-generated import-map and readiness
scripts. Set Waku's framework nonce with `unstable_setNonce` from
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

When Waku invokes the interceptor outside a request phase, its unstable request
accessor throws and Palamedes calls the handler unchanged without activating
i18n. This fallback does not depend on the wording or shape of Waku's error.

Initializer or catalog failures prevent the action body from running and throw
an error beginning `Palamedes Waku i18n initialization failed`. Waku's default
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
`AsyncLocalStorage`. It supports the pinned Waku line `^1.0.0-rc.0` on
Node.js 22.22 or later. Do not use this adapter in Edge or Worker runtimes
unless their Node-compatible `AsyncLocalStorage` behavior has been independently
verified. Waku's interceptor and request-accessor APIs are unstable-prefixed,
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
