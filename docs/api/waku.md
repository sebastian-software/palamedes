# `@palamedes/waku`

`@palamedes/waku` activates a fresh request-local i18n instance around Waku
handlers, including `"use server"` actions. It is opt-in: existing Waku
applications do not change until an interceptor is registered.

## Installation

```sh
pnpm add @palamedes/core @palamedes/runtime @palamedes/waku waku
```

The adapter supports `waku@^1.0.0-rc.0` and Node.js 22.22 or newer. Register the Palamedes Vite plugin for macro transformation and generated catalog
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
import { createViteServerI18n } from "@palamedes/vite-plugin/server";
import { locales } from "./i18n";

export function createRequestI18n(request: Request) {
  const { locale } = locales.resolve({
    strategy: "cookie",
    acceptLanguageHeader: request.headers.get("accept-language"),
    cookieHeader: request.headers.get("cookie"),
  });
  return createViteServerI18n({ locale });
}
```

For document responses, install the Waku middleware after Waku has rendered the
response. It injects only the active locale's generated catalog modules and
gates Waku's client entry on their evaluation. `resolveLocale` remains the
application's host, path, cookie, or header policy; the middleware does not
maintain a second locale map.

```ts
// src/waku.server.ts
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

`clientDirectory` points at the Vite client build containing
`palamedes-split-manifest.json`. If an active fragment cannot be fetched or
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
instance creation to `createViteServerI18n`; the interceptor owns activation
and cleanup. If it fails, the action
body does not run and the server throws an error beginning `Palamedes Waku i18n
initialization failed` with the original cause attached.

Waku enters the handler interceptor before its action dispatcher invokes
`fn(...args)`. The scope therefore begins before action default-parameter
evaluation and remains active through the full awaited action, including direct
macros and synchronous, asynchronous, or cross-module helper calls.

When Waku's unstable request accessor throws because no request phase is
available, the interceptor calls `next()` unchanged: it does not resolve i18n,
establish a scope, or wrap the accessor error. The fallback deliberately does
not inspect the unstable error's message or shape. That keeps non-request
handler execution compatible, but translated code on that path still needs its
own active runtime.

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
interceptor and request APIs are unstable-prefixed; revalidate this adapter when
upgrading Waku.

## Middleware ordering

Waku default-adapter middleware runs before router dispatch and the Palamedes
handler interceptor. Middleware that prepares locale inputs must `await next()`;
an early response never enters the i18n scope. Do not install a competing
Palamedes server scope around this interceptor.
