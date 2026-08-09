# `@palamedes/waku`

`@palamedes/waku` activates a fresh request-local i18n instance around Waku
handlers, including `"use server"` actions. It is opt-in: existing Waku
applications do not change until an interceptor is registered.

## Installation

```sh
pnpm add @palamedes/core @palamedes/runtime @palamedes/waku waku
```

The adapter supports `waku@^1.0.0-beta.9` and Node.js 22.22 or newer. Macros
still need the standard Vite transformation and catalog-loading setup.
`@palamedes/waku` is ESM-only: use `import`; CommonJS `require()` is deliberately
unsupported.

## Interceptor registration

When using Waku's `fsRouter()`, add a default export below
`src/pages/_interceptors/`. Waku discovers these modules and wraps its handlers with
the interceptor.

```ts
// src/pages/_interceptors/palamedes.server.ts
import { createWakuI18nInterceptor } from "@palamedes/waku"
import { createRequestI18n } from "../lib/i18n.server"

export default createWakuI18nInterceptor(async (request) => {
  return await createRequestI18n(request)
})
```

The resolver receives Waku's original Fetch `Request`, including headers and
cookies. It owns locale negotiation, catalog loading, and creation of a fresh
i18n instance; Palamedes owns activation and cleanup. If it fails, the action
body does not run and the server throws an error beginning `Palamedes Waku i18n
initialization failed` with the original cause attached.

Waku enters the handler interceptor before its action dispatcher invokes
`fn(...args)`. The scope therefore begins before action default-parameter
evaluation and remains active through the full awaited action, including direct
macros and synchronous, asynchronous, or cross-module helper calls.

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
