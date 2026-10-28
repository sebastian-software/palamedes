# React Router Framework Mode

`@palamedes/react-router` connects Palamedes to React Router Framework Mode on
Vite. The application adds three pieces next to `@palamedes/vite-plugin`: one
`createReactRouterI18n()` call with its locale policy, the adapter's middleware
on the root route, and the adapter's server entry. Loaders and actions need no
Palamedes code.

This page describes that setup as the checked examples implement it. Palamedes
does not support React Router's experimental RSC mode; use Next.js or Waku for
React Server Components.

| Example                                                           | Locale source                          |
| ----------------------------------------------------------------- | -------------------------------------- |
| [`react-router-cookie`](../../examples/react-router-cookie)       | Cookie, then `Accept-Language`         |
| [`react-router-route`](../../examples/react-router-route)         | First path segment (`/:locale`)        |
| [`react-router-subdomain`](../../examples/react-router-subdomain) | Leftmost host label (`de.example.com`) |
| [`react-router-tld`](../../examples/react-router-tld)             | Rightmost host label (`example.de`)    |

The snippets below come from `react-router-cookie`.
[Locale strategies](#locale-strategies) lists what the other three change.

## Installation

The examples depend on these Palamedes packages next to React Router 8.5.0,
React 19, and Vite 8:

```sh
pnpm add @palamedes/core @palamedes/react @palamedes/react-router @palamedes/runtime @palamedes/vite-plugin
pnpm add -D @palamedes/cli @palamedes/config
```

`@palamedes/react-router` needs `react-router@^8.5.0`, `@react-router/node`,
React 19, and Node.js `>=22.22.0`. It is ESM-only. `@react-router/dev@8.5.0`
declares `vite: ^7.0.0 || ^8.0.0` as its peer range; the examples are verified
on Vite 8.

## Configuration

Declare locales and catalogs in `palamedes.yaml`
(`examples/react-router-cookie/palamedes.yaml`):

```yaml
locales: [en, de, es, fr]
source-locale: en
catalogs:
  - path: app/locales/{locale}
    include: [app]
```

Register the Palamedes plugin before React Router's plugin
(`examples/react-router-cookie/vite.config.ts`):

```ts
import { reactRouter } from "@react-router/dev/vite";
import { palamedes } from "@palamedes/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [palamedes(), reactRouter()],
});
```

The example config also filters a known React Router sourcemap warning; that
filter is unrelated to Palamedes. Catalog delivery needs no plugin option. The
plugin keeps `@palamedes/react-router` in Vite's server module graph, so the
adapter can load the generated server catalogs when it is installed from npm.

## Locale policy

Locale selection stays in application code. The cookie example builds its
controls with `defineLocaleControls` from `@palamedes/core/locale`
(`examples/react-router-cookie/app/lib/i18n.ts`):

```ts
import { defineLocaleControls } from "@palamedes/core/locale";

export const LOCALES = ["en", "de", "es", "fr"] as const;
export const DEFAULT_LOCALE = "en";
export const LOCALE_COOKIE = "locale";
export type Locale = (typeof LOCALES)[number];

export const locales = defineLocaleControls<Locale>({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  cookies: { locale: LOCALE_COOKIE },
});

export function resolveLocaleFromRequest(request: Request) {
  return locales.resolve({
    strategy: "cookie",
    acceptLanguageHeader: request.headers.get("accept-language"),
    cookieHeader: request.headers.get("cookie"),
  });
}
```

`resolve()` returns `{ locale, source }`. When the cookie is missing or holds
an unknown locale, it falls back to the best `Accept-Language` match. See
[locale controls](./core.md#locale-controls) for the API and
[Locale strategies](../locale-strategies.md) for the strategies.

## Create the integration

Create the integration once, in a server-only module
(`examples/react-router-cookie/app/lib/i18n.server.ts`):

```ts
import { createReactRouterI18n } from "@palamedes/react-router";
import { resolveLocaleFromRequest } from "./i18n";

export const i18n = createReactRouterI18n({
  resolveLocale: (request) => resolveLocaleFromRequest(request).locale,
  i18nOptions: { timeZone: "Europe/Berlin" },
  failureMessage: "The page catalog could not be loaded.",
});
```

`createReactRouterI18n(options)` takes:

| Option            | Default                                                                            | Purpose                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `resolveLocale`   | required                                                                           | `(request) => locale`, synchronous or asynchronous. The app's locale policy.                  |
| `i18nOptions`     | `{}`                                                                               | `createI18n` options such as `timeZone`, or `(request, locale) => options`.                   |
| `catalogDelivery` | `{}`                                                                               | `{ clientDirectory?, development?, manifestName?, errorHtml? }`, or `false` to skip delivery. |
| `nonce`           | none                                                                               | `(request, context) => nonce` for React's scripts, the import map, and the readiness script.  |
| `streamTimeout`   | `5000`                                                                             | The entry's stream timeout in milliseconds; the render is aborted one second later.           |
| `failureMessage`  | `Palamedes React Router i18n initialization failed before the route handlers ran.` | Message of the error thrown when the catalog cannot load.                                     |

The adapter creates one server i18n scope per `createReactRouterI18n()` call and
shares it across requests. Each request gets its own i18n instance over the
shared compiled catalog for its locale, loaded through
`createBundledServerI18n` from `@palamedes/runtime/server/bundled`.

`catalogDelivery.clientDirectory` defaults to `build/client` in the process
working directory, React Router's default client build. `development` defaults
to how Vite built the server: `true` under `react-router dev`, `false` in the
output of `react-router build`. The runtime `NODE_ENV` does not change it, so a
custom server that starts a production build without `NODE_ENV` still delivers
the import map. In development the adapter reads no manifest. The examples
start `react-router-serve` in the application directory and use both defaults.

`nonce` is called once per document request, with the request and its load
context, so a server can store a per-request nonce in that context. React's
scripts, the import map, and the readiness script share the value.

## Root route

Register the middleware on the root route, and give the document its locale
with `useDocumentLocale()` (`examples/react-router-cookie/app/root.tsx`):

```tsx
import { useDocumentLocale } from "@palamedes/react-router/document";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

import type { Route } from "./+types/root";
import { DEFAULT_LOCALE } from "~/lib/i18n";
import { i18n } from "~/lib/i18n.server";
import { serverI18nTestBarrier } from "~/lib/test-barrier.server";
import "@palamedes/example-ui/styles.css";

export const middleware: Route.MiddlewareFunction[] = [i18n.middleware, serverI18nTestBarrier];

export function Layout({ children }: { children: React.ReactNode }) {
  const locale = useDocumentLocale() ?? DEFAULT_LOCALE;

  return (
    <html lang={locale} data-palamedes-time-zone="Europe/Berlin">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
```

`serverI18nTestBarrier` exists for the repository's concurrency checks. It does
nothing unless `PALAMEDES_I18N_TEST_BARRIER=1` is set and the request carries
the test header; an application registers only `i18n.middleware`.

React Router 8 always enables route middleware, and the root route matches
every request. `i18n.middleware` resolves the locale, loads the catalog, and
runs `next()` inside the request's scope. Everything below it therefore sees
the request's i18n instance: child middleware, loaders, actions, resource
routes, `.data` requests from client navigations, and the server entry's
document render.

The browser runtime reads the active locale from `<html lang>` and the time
zone from `data-palamedes-time-zone`. The generated browser bootstrap throws if
`lang` is not a configured locale, and in production also if it differs from
the locale of the document's import map.

`useDocumentLocale()` comes from the `@palamedes/react-router/document`
subpath, which a route module can import in the browser. On the server it
returns the locale `handleRequest` resolved for the request. That includes
documents for which no loader ran, such as 404 and 405 responses and the error
document of a catalog failure, so a root loader cannot supply the locale for
every document. In the browser it returns the document's `lang`, which stays
fixed for the document, so hydration renders the same value. It returns
`undefined` only when the request has no locale, for example when
`resolveLocale` threw. The document transform also writes the resolved locale
to `<html lang>`, so the attribute always matches the import map.

Loaders read the resolved locale with `i18n.getLocale(context)` instead of
resolving it again. It throws if the middleware did not run for the request.

## Server entry

The server entry is the adapter's handler
(`examples/react-router-cookie/app/entry.server.tsx`):

```tsx
import { i18n } from "~/lib/i18n.server";

export default i18n.handleRequest;
```

`i18n.handleRequest` is React Router's default Node streaming entry: it answers
`HEAD` without a body, waits for all content for bots and SPA Mode, and aborts
the stream after `streamTimeout`. It renders inside the request scope and pipes
the HTML through the catalog document transform from
`@palamedes/vite-plugin/delivery`. The transform buffers the HTML until
`</head>`, then:

- sets `<html lang>` to the request's locale;
- inserts the locale's `<script type="importmap">` directly after `<head>`;
- removes bare `#pmds/` modulepreload hints that would resolve before the import
  map exists;
- adds a readiness script and `modulepreload` links for the catalog fragments
  of the route chunks that the document already preloads.

React Router answers unknown paths (404) and unsupported methods (405) without
running route middleware or loaders. For those documents `handleRequest`
resolves the locale and scope itself, so they still get the request locale's
`lang`, import map, and messages.

If the entry module exports its own `streamTimeout`, pass the same value to
`createReactRouterI18n()`. An application with its own render code can use
`i18n.run(request, context, work)` for the scope and
`i18n.createDocumentTransform(request, context)` for the Node `Transform`
instead of `handleRequest`. Without `handleRequest`, `useDocumentLocale()`
returns `undefined` on the server; the transform still sets `<html lang>`, and
the browser reads that value. The checked examples do not need either.

## Client entry

The client entry needs no Palamedes code
(`examples/react-router-cookie/app/entry.client.tsx`):

```tsx
import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
  );
});
```

Modules generated by the Vite plugin create and load the browser i18n instance
for the document's `lang` before translated modules run.

## Loaders and actions

Loaders, actions, and resource routes use macros directly
(`examples/react-router-cookie/app/routes/server-status.ts`):

```ts
import { t } from "@palamedes/core/macro";
import type { Route } from "./+types/server-status";
import { getLocaleLabel, resolveLocaleFromRequest } from "~/lib/i18n";

export async function loader({ request }: Route.LoaderArgs) {
  const resolved = resolveLocaleFromRequest(request);
  return {
    proof: {
      handledAt: new Date().toISOString(),
      locale: resolved.locale,
      localeLabel: getLocaleLabel(resolved.locale),
      message: t`Server query confirmed locale ${resolved.locale}.`,
    },
  };
}
```

React Router runs loaders and actions inside the root middleware's `next()`, on
document requests and on the `.data` requests of client navigations alike.
`routes/home.tsx` and `routes/insights.tsx` follow the same pattern. Translated
server code that runs outside any request, such as at module scope, throws
`No active server i18n instance`.

## Locale strategies

The route, subdomain, and TLD examples pass their resolver directly, because
it already returns a locale
(`examples/react-router-route/app/lib/i18n.server.ts`):

```ts
import { createReactRouterI18n } from "@palamedes/react-router";
import { resolveLocaleFromRequest } from "./i18n";

export const i18n = createReactRouterI18n({
  resolveLocale: resolveLocaleFromRequest,
  i18nOptions: { timeZone: "Europe/Berlin" },
});
```

Their root route and server entry match the cookie example. Without a
`failureMessage`, a catalog failure carries the adapter's default message.

| Strategy  | Locale resolution                                                                                               | Locale switch                                                                                                |
| --------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Cookie    | `locales.resolve({ strategy: "cookie", … })`                                                                    | `<Form method="post" reloadDocument>`; the action sets the cookie and redirects.                             |
| Route     | `params.locale` in the route; the resolver reads the first path segment. `/` redirects to the preferred locale. | Plain `<a>` to the locale path, such as `/de`; the click stores the choice with `locales.serializeChoice()`. |
| Subdomain | `locales.resolve({ strategy: "subdomain", … })` with the `Host` header                                          | Plain `<a>` to `locales.canonicalUrl(…)`; the click stores the choice with `serializeChoice()`.              |
| TLD       | `locales.resolve({ strategy: "tld", … })` with the `Host` header                                                | Plain `<a>` to `locales.canonicalUrl(…)`; the click stores the choice with `serializeChoice()`.              |

The middleware receives the raw request, so in the route example client
navigations arrive as `/<locale>.data`. Its `resolveLocaleFromRequest` strips
the `.data` suffix from the first segment; without that, those requests fall
back to `Accept-Language`.

Every switch is a document navigation. The import map in the document head
fixes the browser's catalog assets for one locale, so a new locale needs a new
document. See [ADR-007](../../adr/007-locale-is-fixed-for-a-browser-document.md).

The route, subdomain, and TLD roots still set a `window.__PALAMEDES_LOCALE__`
global. No Palamedes package reads it; the cookie example does without it.

## Error UI

Error UI must not depend on message catalogs. The examples' root
`ErrorBoundary` uses plain text and offers a reload
(`examples/react-router-cookie/app/root.tsx`):

```tsx
export function ErrorBoundary() {
  return (
    <main role="alert">
      <h1>This page is temporarily unavailable.</h1>
      <p>Reload the page to try again.</p>
      <button type="button" onClick={() => window.location.reload()}>
        Reload page
      </button>{" "}
      <a href="/">Go home</a>
    </main>
  );
}
```

Catalog failures reach the user through these paths:

- **Initial document, production.** React Router imports the initial route
  modules before `entry.client` runs. The readiness script that the document
  transform adds imports the same catalog fragments. If one fails, it replaces
  the page body with `errorHtml`. The default markup is a `role="alert"` view
  with Reload and Home links. A custom `catalogDelivery.errorHtml` must be
  trusted, catalog-independent markup.
- **Later route loads, production.** The plugin wraps each React Router client
  route chunk. Once the initial catalogs are ready, a failed route import no
  longer triggers React Router's automatic reload. The route component throws
  instead, and the nearest `ErrorBoundary` renders.
- **Development.** The transform listens for the plugin's `palamedes:catalogError`
  event and renders `errorHtml`.
- **Server.** If the request's catalog cannot load, the middleware throws
  `new Error(failureMessage, { cause })` before any loader runs. React Router
  renders the nearest `ErrorBoundary` with status 500 for document requests and
  serializes the error for `.data` requests. The adapter renders that error
  document without an i18n scope. The root `Layout` wraps it too, so neither
  the boundary nor the `Layout` may use messages. The document still gets the
  request locale's `lang` and import map, because the browser catalogs are
  separate files that may still load.
- **Client build.** If the client manifest or the locale's import map is
  missing or unreadable, the document transform throws the same
  `failureMessage` error with the cause attached. React Router passes it to
  `handleError` and renders the root `ErrorBoundary` with status 500 again.
  That second document has no import map, so the server-rendered error view
  stays without hydration instead of becoming React Router's bare
  "Unexpected Server Error" response.

The production proof runs the built cookie example in English and German. It
injects network and evaluation failures into initial and lazy catalog fragments
under a hash-based script CSP. It then checks that only active-locale catalogs
load, that the alert view appears, and that Reload recovers. A second proof
covers the development server. The smoke check builds the examples and sends
overlapping mixed-locale requests through the test barrier; the browser check
then runs both proofs after its `react-router-cookie` checks:

```sh
pnpm verify:examples:smoke --framework react-router
pnpm verify:examples:browser --framework react-router
```

## Limits

- The adapter runs on Node. The server scope uses `AsyncLocalStorage` from
  `node:async_hooks`, and the server entry uses Node streams; Edge and Worker
  runtimes are not supported.
- Locale changes require a new document; there is no in-place switch.
- Production delivery needs the client build: a missing manifest or import map
  for a configured locale renders the error document described under
  [Error UI](#error-ui).
- The four examples pin React Router 8.5.0 and Vite 8. Other versions are not
  verified.
- React Router's RSC mode is not supported
  ([ADR-026](../../adr/026-react-router-rsc-entry-request-scope.md)).
