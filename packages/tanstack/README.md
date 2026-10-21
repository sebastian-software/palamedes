# @palamedes/tanstack

Request-scoped i18n middleware for TanStack Start server functions and SSR.

## Installation

```sh
pnpm add @palamedes/core @palamedes/runtime @palamedes/tanstack @tanstack/react-start
```

`@palamedes/tanstack` is ESM-only. Use ESM imports; CommonJS
`require("@palamedes/tanstack")` is not supported.

## Verified dependency baseline and Solid follow-up

The React fixtures pin `@tanstack/react-start@1.169.3` and
`@tanstack/react-router@1.170.45`. React Start requires `seroval@^1.6.7`;
the workspace override uses 1.6.9. Keeping the previous 1.6.3 override causes
Start to fail at module import because its serializer has no `isStream` export.

Solid Start remains **under integration verification** in
[#1252](https://github.com/sebastian-software/palamedes/issues/1252).
The existing Solid/Nitro examples use Solid and `@solidjs/web@2.0.0-rc.16`
with the Solid Vite plugin's Start Mode.
Solid Start's separate `2.0.0-rc.8` release requires
`@solidjs/web >=2.0.0-rc.6 <3.0.0`, which the current Nitro baseline satisfies.
That runtime peer match does not verify the separate Start host. The stable 1.169.3 package declares
`solid-js >=1.0.0`; that broad peer range alone does not prove compatibility
with Palamedes' Solid 2 baseline. Neither Start line is proven by the Nitro examples.

A probe using Solid Start 2.0.0-rc.8 with matching Solid and
`@solidjs/web@2.0.0-rc.6` also exposed legacy Solid 1 Vite-plugin peers.
Importing that host's root entry directly in Node evaluates client DOM
`template()` calls and throws a client-only API error. This does not establish
whether Start's bundled server path fails; it needs its own representative
fixture and SSR/hydration/navigation/catalog-failure browser checks before a
Solid host export or support claim is added.

The v2 publication hold remains active until both Start integrations are proven.

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

For a nonce-based CSP, give TanStack Router's native `ssr.nonce` option and the
adapter's `catalogDelivery.nonce` option the same request nonce. The router
owns its framework scripts; the adapter owns its generated import map and
catalog-readiness tags.

With a route-locale strategy, a `createServerFn()` request reaches the
server-function endpoint and may have no `Referer` under a `no-referrer`
policy. Send the selected locale in an explicit request header such as
`x-palamedes-locale`, and validate it in the application's locale resolver.
That header carries locale policy only; the adapter still loads the configured
compiled catalog.

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
`@tanstack/react-start@^1.169.3` on Node.js 22.22 or later. Do not use this
adapter in Edge or Worker runtimes unless their Node-compatible
`AsyncLocalStorage` behavior has been independently verified.

The scope covers the complete awaited middleware and server-function invocation.
If a deployment detaches work after the function resolves, pass locale data to
that detached work explicitly; it is outside the request scope.

<!-- ferramenta-family:start -->

**palamedes** is part of the [Ferramenta](https://ferramenta.dev) family — A family of Rust tools.

Siblings: [ferroni](https://sebastian-software.github.io/ferroni/) — Oniguruma-compatible regex engine · [ferriki](https://github.com/sebastian-software/ferriki) — Shiki-compatible syntax highlighting · [ferromark](https://sebastian-software.github.io/ferromark/) — Markdown to HTML with a secure default and every GFM extension included. · [ferrolex](https://github.com/sebastian-software/ferrolex) — Spell checking for text and code · [ferrocat](https://ferrocat.dev) — Translation catalog engine · [ferrovia](https://github.com/sebastian-software/ferrovia) — SVGO-compatible SVG optimizer · [ferralk](https://github.com/sebastian-software/ferralk) — Glob matching and parallel filesystem walking · [ferrugo](https://github.com/sebastian-software/ferrugo) — PDF previews for untrusted files.
<!-- ferramenta-family:end -->

## License

MIT OR Apache-2.0 © 2026 Sebastian Software
