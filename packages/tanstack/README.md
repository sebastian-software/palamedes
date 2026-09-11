# @palamedes/tanstack

Request-scoped i18n middleware for TanStack Start server functions and SSR.

## Installation

```sh
pnpm add @palamedes/core @palamedes/runtime @palamedes/tanstack @tanstack/react-start
```

`@palamedes/tanstack` is ESM-only. Use ESM imports; CommonJS
`require("@palamedes/tanstack")` is not supported.

## Global server-function middleware

Create the middleware once and register it in `src/start.ts`. The resolver gets
the original request, so it can read headers and cookies to negotiate a locale.
The adapter loads the generated catalog, creates a fresh instance for each
request, and binds the active catalog to SSR documents through the Vite delivery
seam.

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

Because Start includes `src/start.ts` in its client graph, put this middleware
inside `createIsomorphicFn().server()`. Start removes the server branch from the
client build. `@palamedes/vite-plugin` provides the
`virtual:palamedes/server-catalogs` module used by the adapter. It dynamically
loads the configured catalogs and shares each prepared locale catalog in the
server process. The application supplies locale policy only; it does not import
catalog files, maintain loader maps, or modify document HTML.

The request middleware runs for both page rendering and server functions. It
starts before Start decodes and invokes the server function, and keeps the
request-local scope active until its awaited `next()` completes. In production,
HTML responses receive the active locale import map and catalog readiness probe
before route modules execute. The default client directory is `dist/client`;
pass `{ catalogDelivery: false }` only for a host that owns an equivalent
transport.

If the resolver fails, the server function does not run and the middleware
throws an error beginning `Palamedes TanStack i18n initialization failed`, with
the original cause attached.

## SSR page rendering

The request middleware also owns SSR, so the server entry only needs to call the
Start handler:

```ts
import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";

const handler = createStartHandler(defaultStreamHandler);

export default {
  async fetch(request: Request, options?: never) {
    return await handler(request, options);
  },
};
```

## Per-function middleware

Use `createTanStackI18nMiddleware()` when only selected server functions need
i18n. Register the result in `functionMiddleware` for every server function,
or compose it with an individual function:

```ts
const palamedesI18n = createTanStackI18nMiddleware(resolveRequestI18n);

export const saveProfile = createServerFn({ method: "POST" })
  .middleware([palamedesI18n])
  .handler(async () => ({ message: t`Saved` }));
```

The global request middleware is the recommended default because its resolver
has a typed `Request` and covers Start's entire server-function request path.
The composable middleware uses Start's supported `getRequest()` server accessor
and begins before server-function validation and handler execution.

## Runtime requirements

`@palamedes/tanstack` uses `@palamedes/runtime/server`, which requires Node's
`AsyncLocalStorage`. It supports the pinned TanStack Start line
`@tanstack/react-start@^1.168.38` on Node.js 22.22 or later. Do not use this
adapter in Edge or Worker runtimes unless their Node-compatible
`AsyncLocalStorage` behavior has been independently verified.

The scope covers the complete awaited middleware and server-function invocation.
If a deployment detaches work after the function resolves, pass locale data to
that detached work explicitly; it is outside the request scope.

<!-- ferramenta-family:start -->

**palamedes** is part of the [Ferramenta](https://ferramenta.dev) family — Rust-native developer tools that keep the APIs the ecosystem already knows.

Siblings: [ferroni](https://sebastian-software.github.io/ferroni/) · [ferriki](https://github.com/sebastian-software/ferriki) · [ferromark](https://sebastian-software.github.io/ferromark/) · [ferrolex](https://github.com/sebastian-software/ferrolex) · [ferrocat](https://ferrocat.dev) · [ferrovia](https://github.com/sebastian-software/ferrovia) · [ferralk](https://github.com/sebastian-software/ferralk) · [ferrugo](https://github.com/sebastian-software/ferrugo).
<!-- ferramenta-family:end -->

## License

MIT OR Apache-2.0 © 2026 Sebastian Software
