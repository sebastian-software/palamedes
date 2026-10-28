# @palamedes/react-router

Request-scoped i18n middleware and a streaming server entry for React Router
Framework Mode.

## Installation

```sh
pnpm add @palamedes/core @palamedes/react @palamedes/react-router @palamedes/runtime @palamedes/vite-plugin
```

The adapter needs React Router `^8.5.0`, `@react-router/node`, React 19, and
Node.js `>=22.22.0`. It is ESM-only; CommonJS `require("@palamedes/react-router")`
is not supported. React Router's experimental RSC mode is not supported.

## Setup

Register `palamedes()` before `reactRouter()` in `vite.config.ts`. Then add
three small pieces of server code.

Create the integration once, in a server-only module. The application keeps
its locale policy; the adapter loads the compiled catalog for that locale:

```ts
// app/lib/i18n.server.ts
import { createReactRouterI18n } from "@palamedes/react-router";
import { resolveLocaleFromRequest } from "./i18n";

export const i18n = createReactRouterI18n({
  resolveLocale: (request) => resolveLocaleFromRequest(request).locale,
  i18nOptions: { timeZone: "Europe/Berlin" },
});
```

Register the middleware on the root route and give the document its language:

```tsx
// app/root.tsx
export const middleware: Route.MiddlewareFunction[] = [i18n.middleware];

export async function loader({ context }: Route.LoaderArgs) {
  return { locale: i18n.getLocale(context) };
}
```

Render `<html lang={locale}>` from that loader data. The browser runtime reads
the active locale from `lang`.

Use the adapter's server entry:

```tsx
// app/entry.server.tsx
import { i18n } from "~/lib/i18n.server";

export default i18n.handleRequest;
```

Loaders and actions need no wrapping. The root middleware runs the rest of the
request inside the request's i18n scope: child middleware, loaders, actions,
resource routes, `.data` requests, and the document render.

## What the adapter does

- `middleware` resolves the locale once per request, loads that locale's
  compiled catalog, and runs `next()` inside a server i18n scope. The scope is
  created once per `createReactRouterI18n()` call and shared by all requests.
- `handleRequest` is React Router's default Node streaming entry. It renders
  inside the request scope and pipes the HTML through the catalog document
  transform from `@palamedes/vite-plugin/delivery`. In production that adds the
  active locale's import map, catalog preloads, and a readiness script before
  route modules run.
- Documents that never reach route middleware, such as 404 and 405 responses,
  resolve their scope and import map in `handleRequest`.
- `getLocale(context)` returns the locale the middleware resolved, so the root
  loader does not resolve it a second time.

## Options

| Option            | Default                                                                            | Purpose                                                                             |
| ----------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `resolveLocale`   | required                                                                           | `(request) => locale`. The app's cookie, route, subdomain, or TLD policy.           |
| `i18nOptions`     | `{}`                                                                               | `createI18n` options such as `timeZone`, or `(request, locale) => options`.         |
| `catalogDelivery` | `{}`                                                                               | `{ clientDirectory, development, manifestName, errorHtml }`, or `false` to disable. |
| `nonce`           | none                                                                               | `(request) => nonce` for React's scripts, the import map, and the readiness script. |
| `streamTimeout`   | `5000`                                                                             | Milliseconds before a streaming render is aborted (plus one second).                |
| `failureMessage`  | `Palamedes React Router i18n initialization failed before the route handlers ran.` | Message of the error thrown when the catalog cannot load.                           |

`catalogDelivery.clientDirectory` defaults to `build/client` in the process
working directory, and `development` defaults to
`process.env.NODE_ENV !== "production"`. In production, a missing manifest or
import map for a configured locale throws.

If the entry module exports its own `streamTimeout`, pass the same value to
`createReactRouterI18n()`.

## Errors

If the catalog cannot load, the middleware throws
`new Error(failureMessage, { cause })`. React Router renders the nearest
`ErrorBoundary` for document requests and serializes the error for `.data`
requests. The error document is rendered without an i18n scope, so error UI
must not depend on message catalogs.

## Custom server entries

An entry that needs its own render code can use the lower-level functions:

- `i18n.run(request, context, work)` runs `work` inside the request scope.
- `i18n.createDocumentTransform(request, context)` resolves the Node
  `Transform` that injects the import map; pipe React's HTML through it.

## Documentation

See the [React Router Framework Mode guide](../../docs/api/react-router.md) and
the four `examples/react-router-*` applications.

<!-- ferramenta-family:start -->

**palamedes** is part of the [Ferramenta](https://ferramenta.dev) family — A family of Rust tools.

Siblings: [ferroni](https://sebastian-software.github.io/ferroni/) — Oniguruma-compatible regex engine · [ferriki](https://github.com/sebastian-software/ferriki) — Shiki-compatible syntax highlighting · [ferromark](https://sebastian-software.github.io/ferromark/) — Markdown to HTML with a secure default and every GFM extension included. · [ferrolex](https://github.com/sebastian-software/ferrolex) — Spell checking for text and code · [ferrocat](https://ferrocat.dev) — Translation catalog engine · [ferrovia](https://github.com/sebastian-software/ferrovia) — SVGO-compatible SVG optimizer · [ferralk](https://github.com/sebastian-software/ferralk) — Glob matching and parallel filesystem walking · [ferrugo](https://github.com/sebastian-software/ferrugo) — PDF previews for untrusted files.
<!-- ferramenta-family:end -->

## License

MIT OR Apache-2.0 © 2026 Sebastian Software
