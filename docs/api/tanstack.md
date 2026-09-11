# `@palamedes/tanstack`

`@palamedes/tanstack` activates a fresh request-local i18n instance around
TanStack Start page requests and `createServerFn()` invocations. It is opt-in: existing
TanStack Start applications do not change unless they install and register the
middleware.

## Installation

```sh
pnpm add @palamedes/core @palamedes/runtime @palamedes/tanstack @tanstack/react-start
```

The adapter supports `@tanstack/react-start@^1.168.38` and Node.js 22.22 or
newer. Palamedes macros still need the standard Vite transformation and catalog
loading setup. `@palamedes/tanstack` is ESM-only: use ESM imports, not
`require("@palamedes/tanstack")`.

## Recommended: global request middleware

Register the helper once in `src/start.ts`. It covers page rendering and
Start's `serverFn` requests.

```ts
import { createIsomorphicFn, createStart } from "@tanstack/react-start";
import { createTanStackServerI18nRequestMiddleware } from "@palamedes/tanstack";

const palamedesI18n = createIsomorphicFn().server(() =>
  createTanStackServerI18nRequestMiddleware((request) => resolveLocaleFromRequest(request)),
)();

export const startInstance = createStart(() => ({
  requestMiddleware: [palamedesI18n],
}));
```

`src/start.ts` participates in Start's client graph. Keep this middleware inside
`createIsomorphicFn().server()`, as in this example; Start removes that branch
from the client build. The Vite plugin provides the generated
`virtual:palamedes/server-catalogs` module. It owns catalog imports, the shared
immutable server store, and production document delivery; the application
supplies locale policy only.

The resolver receives the original Fetch `Request`, including headers and
cookies. It owns locale negotiation, catalog loading, and creation of a fresh
i18n instance; Palamedes owns activation and cleanup. An initializer failure
stops the server function and throws an error beginning `Palamedes TanStack
i18n initialization failed`, with the original cause attached.

Start invokes this boundary before page rendering and before decoding a server
function. The scope stays active through awaited `next()`, including validation,
handler work, and synchronous, asynchronous, or cross-module helpers that call
translated code. Production HTML receives the active locale import map and
readiness probe before route modules execute; the default client directory is
`dist/client`.

## SSR page rendering

The request middleware owns SSR, so the server entry only calls Start's handler:

```ts
import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";

const handler = createStartHandler(defaultStreamHandler);

export default {
  async fetch(request: Request, options?: never) {
    return await handler(request, options);
  },
};
```

## Composable server-function middleware

For selected functions, use `createTanStackI18nMiddleware(resolveI18n)` and
install the result with `.middleware([palamedesI18n])`. It can also be added to
`createStart({ functionMiddleware: [palamedesI18n] })` for all server
functions. This alternative calls Start's public `getRequest()` accessor to
give the resolver the original request. Prefer the request middleware above
when scope must begin before request payload decoding.

Do not install both helpers for the same functions: that would create and load
two request-local i18n instances unnecessarily.

## Runtime limitations

The adapter relies on `@palamedes/runtime/server` and Node's
`AsyncLocalStorage`. It is not supported in Edge or Worker runtimes unless
their Node-compatible `AsyncLocalStorage` behavior has been independently
verified. Detached work that starts after a server function resolves is outside
the request scope; carry needed locale data into that work explicitly.
