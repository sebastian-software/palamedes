# React Router Framework Mode

React Router Framework Mode on Vite has no dedicated Palamedes adapter package.
The integration is `@palamedes/vite-plugin` plus a small amount of server
wiring that the application writes itself: a request-scoped server i18n
runner, the catalog document transform in `app/entry.server.tsx`, and a scope
around each loader and action that runs translated code.

This page describes that wiring as the checked examples implement it today. For
React Router RSC Framework Mode, use the separate
[`@palamedes/react-router-rsc`](./react-router-rsc.md) package instead.

| Example                                                           | Locale source                          |
| ----------------------------------------------------------------- | -------------------------------------- |
| [`react-router-cookie`](../../examples/react-router-cookie)       | Cookie, then `Accept-Language`         |
| [`react-router-route`](../../examples/react-router-route)         | First path segment (`/:locale`)        |
| [`react-router-subdomain`](../../examples/react-router-subdomain) | Leftmost host label (`de.example.com`) |
| [`react-router-tld`](../../examples/react-router-tld)             | Rightmost host label (`example.de`)    |

The snippets below come from `react-router-cookie`.
[Locale strategies](#locale-strategies) lists what the other three change.

## Installation

The examples depend on these Palamedes packages next to React Router 8.3.1,
React 19, and Vite 8:

```sh
pnpm add @palamedes/core @palamedes/react @palamedes/runtime @palamedes/vite-plugin
pnpm add -D @palamedes/cli @palamedes/config
```

`@react-router/dev@8.3.1` declares `vite: ^7.0.0 || ^8.0.0` as its peer range;
the examples are verified on Vite 8.

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
filter is unrelated to Palamedes. Catalog delivery needs no plugin option.

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

## Server i18n and catalog delivery

Create the request runner and the catalog delivery once, in a server-only
module (`examples/react-router-cookie/app/lib/i18n.server.ts`):

```ts
import path from "node:path";
import { createScopedI18nRunner } from "@palamedes/runtime/server";
import { createBundledServerI18n } from "@palamedes/runtime/server/bundled";
import { createViteCatalogDelivery } from "@palamedes/vite-plugin/delivery";
import { resolveLocaleFromRequest } from "./i18n";

export const serverI18n = createScopedI18nRunner(
  (request) =>
    createBundledServerI18n({
      locale: resolveLocaleFromRequest(request).locale,
      timeZone: "Europe/Berlin",
    }),
  { failureMessage: "The page catalog could not be loaded." },
);

export const catalogDelivery = createViteCatalogDelivery({
  clientDirectory: path.resolve(process.cwd(), "build/client"),
  development: process.env.NODE_ENV !== "production",
});
```

- `createScopedI18nRunner(resolve, { failureMessage })` returns
  `{ run(request, next), scope }`. `run()` resolves a fresh i18n instance for
  the request and runs `next` inside the shared server i18n scope. If the
  resolver throws, `run()` throws `new Error(failureMessage, { cause })`.
- `createBundledServerI18n` from `@palamedes/runtime/server/bundled` loads the
  active locale's compiled catalog from the store that the Vite plugin
  generates, then returns a new i18n instance for that locale. Pass `timeZone` and other `createI18n`
  options here.
- `createViteCatalogDelivery({ clientDirectory, development?, manifestName? })`
  reads the client build's `palamedes-split-manifest.json` and the locale import
  maps it names. React Router's client build is normally `build/client`. With
  `development: true` it reads nothing and returns a `null` binding.

`clientDirectory` above is resolved against the process working directory, so
the cookie example expects its server to start in the application directory.
The other three examples resolve it relative to the server build instead:
`path.resolve(import.meta.dirname, "../client")`, with
`development: import.meta.env.DEV`.

## Document language

The browser runtime reads the active locale from `<html lang>` and the time
zone from `data-palamedes-time-zone`, so the root layout must render both from
the same locale policy (`examples/react-router-cookie/app/root.tsx`):

```tsx
export async function loader({ request }: Route.LoaderArgs) {
  return {
    locale: resolveLocaleFromRequest(request).locale,
  };
}

export function Layout({ children }: { children: React.ReactNode }) {
  const loaderData = useRouteLoaderData<typeof loader>("root");
  const locale = loaderData?.locale ?? DEFAULT_LOCALE;

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

The generated browser bootstrap throws if `lang` is not a configured locale.

## Server entry

`app/entry.server.tsx` keeps React Router's streaming entry and adds two
things: it renders inside `serverI18n.run()`, and it pipes the HTML through the
catalog document transform (`examples/react-router-cookie/app/entry.server.tsx`,
test-only barrier calls omitted):

```tsx
import { PassThrough } from "node:stream";

import type { EntryContext, RouterContextProvider } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { ServerRouter } from "react-router";
import { isbot } from "isbot";
import type { RenderToPipeableStreamOptions } from "react-dom/server";
import { renderToPipeableStream } from "react-dom/server";
import { resolveLocaleFromRequest } from "~/lib/i18n";
import { catalogDelivery, serverI18n } from "~/lib/i18n.server";

export const streamTimeout = 5000;

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  loadContext: RouterContextProvider,
) {
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, { status: responseStatusCode, headers: responseHeaders });
  }

  const locale = resolveLocaleFromRequest(request).locale;
  return serverI18n.run(request, async () => {
    return new Promise((resolve, reject) => {
      let shellRendered = false;
      const userAgent = request.headers.get("user-agent");
      const readyOption: keyof RenderToPipeableStreamOptions =
        (userAgent && isbot(userAgent)) || routerContext.isSpaMode ? "onAllReady" : "onShellReady";
      let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(
        () => abort(),
        streamTimeout + 1000,
      );
      const { pipe, abort } = renderToPipeableStream(
        <ServerRouter context={routerContext} url={request.url} />,
        {
          [readyOption]() {
            shellRendered = true;
            const body = new PassThrough({
              final(callback) {
                clearTimeout(timeoutId);
                timeoutId = undefined;
                callback();
              },
            });
            const stream = createReadableStreamFromReadable(body);
            responseHeaders.set("Content-Type", "text/html");
            const injector = catalogDelivery.createDocumentTransform(
              catalogDelivery.getLocaleBinding(locale),
            );
            injector.pipe(body);
            pipe(injector);
            resolve(new Response(stream, { headers: responseHeaders, status: responseStatusCode }));
          },
          onShellError(error: unknown) {
            reject(error);
          },
          onError(error: unknown) {
            responseStatusCode = 500;
            if (shellRendered) console.error(error);
          },
        },
      );
    });
  });
}
```

The example also calls `waitForServerI18nTestBarrier` and
`markServerI18nTestBarrierReached` from `@palamedes/runtime/server/test`. Those
hooks exist for the repository's concurrency checks. They do nothing unless
`PALAMEDES_I18N_TEST_BARRIER=1` is set and the request carries the test header,
and applications do not need them.

`getLocaleBinding(locale)` returns the locale's import map and chunk mapping,
or `null` in development. In production it throws when the manifest or the
locale's import map is missing or invalid. The route, subdomain, and TLD
examples call it before rendering starts rather than inside the shell
callback.

`createDocumentTransform(binding, { nonce?, errorHtml? })` returns a Node
`Transform`. It buffers the HTML until `</head>`, then:

- inserts the locale's `<script type="importmap">` directly after `<head>`;
- removes bare `#pmds/` modulepreload hints that would resolve before the import
  map exists;
- adds a readiness script and `modulepreload` links for the catalog fragments
  of the route chunks that the document already preloads.

`nonce` is applied to the import map and the readiness script. The examples do
not pass one. `errorHtml` is described under [Error UI](#error-ui). In
production with a `null` binding, the transform passes HTML through unchanged.

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

React Router runs loaders and actions before it calls the server entry for a
document request. For client navigations it serves `.data` requests without
calling the entry at all. The entry's scope therefore does not cover them. Wrap
every loader, action, and resource route that runs translated code
(`examples/react-router-cookie/app/routes/server-status.ts`):

```ts
import { t } from "@palamedes/core/macro";
import type { Route } from "./+types/server-status";
import { getLocaleLabel, resolveLocaleFromRequest } from "~/lib/i18n";
import { serverI18n } from "~/lib/i18n.server";

export async function loader({ request }: Route.LoaderArgs) {
  return serverI18n.run(request, async () => {
    const resolved = resolveLocaleFromRequest(request);
    return {
      proof: {
        handledAt: new Date().toISOString(),
        locale: resolved.locale,
        localeLabel: getLocaleLabel(resolved.locale),
        message: t`Server query confirmed locale ${resolved.locale}.`,
      },
    };
  });
}
```

`routes/home.tsx` and `routes/insights.tsx` wrap their loaders and actions the
same way. The root loader only reads the locale and is not wrapped. Translated
server code that runs outside a scope throws `No active server i18n instance`.

## Locale strategies

The route, subdomain, and TLD examples resolve the locale before creating the
i18n instance. They use `createServerI18nScope()` and a small `runServerI18n`
helper instead of `createScopedI18nRunner`
(`examples/react-router-route/app/lib/i18n.server.ts`):

```ts
import { createBundledServerI18n } from "@palamedes/runtime/server/bundled";
import { createServerI18nScope } from "@palamedes/runtime/server";
import type { Locale } from "./i18n";

export const serverI18nScope = createServerI18nScope();

export function createServerI18n(locale: Locale) {
  return createBundledServerI18n({ locale, timeZone: "Europe/Berlin" });
}

export async function runServerI18n<Result>(
  locale: Locale,
  work: () => Result | Promise<Result>,
): Promise<Result> {
  const i18n = await createServerI18n(locale);
  return serverI18nScope.run(i18n, work);
}
```

Their entry awaits `createServerI18n(locale)` and renders inside
`serverI18nScope.run(i18n, …)`. Loaders and actions call
`runServerI18n(locale, …)`. Unlike `createScopedI18nRunner`, this helper does
not wrap catalog errors in a custom message.

| Strategy  | Locale resolution                                                                                            | Locale switch                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Cookie    | `locales.resolve({ strategy: "cookie", … })`                                                                 | `<Form method="post" reloadDocument>`; the action sets the cookie and redirects.                             |
| Route     | `params.locale` in the route; the entry reads the first path segment. `/` redirects to the preferred locale. | Plain `<a>` to the locale path, such as `/de`; the click stores the choice with `locales.serializeChoice()`. |
| Subdomain | `locales.resolve({ strategy: "subdomain", … })` with the `Host` header                                       | Plain `<a>` to `locales.canonicalUrl(…)`; the click stores the choice with `serializeChoice()`.              |
| TLD       | `locales.resolve({ strategy: "tld", … })` with the `Host` header                                             | Plain `<a>` to `locales.canonicalUrl(…)`; the click stores the choice with `serializeChoice()`.              |

In the route example, client navigations request `/<locale>.data`. Its
`resolveLocaleFromRequest` strips the `.data` suffix from the first segment;
without that, the root loader falls back to `Accept-Language`.

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
  with Reload and Home links. A custom `errorHtml` must be trusted,
  catalog-independent markup.
- **Later route loads, production.** The plugin wraps each React Router client
  route chunk. Once the initial catalogs are ready, a failed route import no
  longer triggers React Router's automatic reload. The route component throws
  instead, and the nearest `ErrorBoundary` renders.
- **Development.** The transform listens for the plugin's `palamedes:catalogError`
  event and renders `errorHtml`.
- **Server.** A failed server catalog load throws. With
  `createScopedI18nRunner`, the error carries `failureMessage` and the original
  cause. React Router treats it like any other server error. If the server
  entry itself fails, React Router renders once more with the error. When that
  render fails as well, it returns its last-resort error response.

The production proof runs the built cookie example in English and German. It
injects network and evaluation failures into initial and lazy catalog fragments
under a hash-based script CSP. It then checks that only active-locale catalogs
load, that the alert view appears, and that Reload recovers. A second proof
covers the development server. The smoke check builds the examples; the
browser check then runs both proofs after its `react-router-cookie` checks:

```sh
pnpm verify:examples:smoke --framework react-router
pnpm verify:examples:browser --framework react-router
```

## Limits

- There is no `@palamedes/react-router` package. Applications own
  `app/entry.server.tsx`, the request scope, and the loader and action
  wrappers shown above.
- The examples run on Node with `react-router-serve`. The server scope uses
  `AsyncLocalStorage` from `node:async_hooks`; Edge and Worker runtimes are not
  verified.
- Locale changes require a new document; there is no in-place switch.
- Production delivery needs the client build: a missing manifest or import map
  for a configured locale throws.
- The four examples pin React Router 8.3.1 and Vite 8. Other versions are not
  verified.
- The [stability table](../stability.md#stability-tiers) has no row for this
  host or for the `@palamedes/vite-plugin/delivery` subpath.
