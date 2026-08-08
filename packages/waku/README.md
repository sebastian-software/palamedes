# @palamedes/waku

Request-scoped i18n interceptor for Waku server actions.

## Installation

```sh
pnpm add @palamedes/core @palamedes/runtime @palamedes/waku waku
```

## Waku handler interceptor

Create one interceptor under `src/pages/_interceptors/`. `fsRouter()` discovers this
directory automatically. The resolver receives Waku's original Fetch request,
so it can read headers and cookies to negotiate a locale and load its catalog.
It must return a fresh activated i18n instance for each request.

```ts
// src/pages/_interceptors/palamedes.server.ts
import { createWakuI18nInterceptor } from "@palamedes/waku"
import { createRequestI18n } from "../lib/i18n.server"

export default createWakuI18nInterceptor(async (request) => {
  return await createRequestI18n(request)
})
```

This is opt-in. Existing Waku applications do not change until an interceptor
is registered. Waku invokes the interceptor before it invokes `"use server"`
actions, including default-parameter evaluation. It keeps the scope active for
the full awaited action, including synchronous, asynchronous, and cross-module
helpers that use transformed Palamedes macros.

Initializer or catalog failures prevent the action body from running and throw
an error beginning `Palamedes Waku i18n initialization failed`. Waku's default
production handler returns its generic 500 response for uncaught errors; keep
server logs available to retain the error cause.

## Streaming and runtime limits

The interceptor awaits Waku's handler promise. Waku creates the response
`ReadableStream` inside that scope, so Node's `AsyncLocalStorage` retains the
active locale in stream callbacks created by the handler. The scope itself is
restored after the response completes for the caller that initiated it.

`@palamedes/waku` uses `@palamedes/runtime/server`, which requires Node's
`AsyncLocalStorage`. It supports the pinned Waku line `^1.0.0-beta.8` on
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

## License

MIT © 2026 Sebastian Software
