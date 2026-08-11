# Palamedes In Backend Servers

Palamedes is not limited to React frameworks.

The same steady runtime model also works in regular request/response servers.
That matters when translations need to appear in emails, API-rendered HTML,
server actions, or small backend services that sit next to the frontend.

If transformed code can resolve the active i18n instance through
`@palamedes/runtime`, the same model also works in backend applications such as:

- Express
- Hono
- Fastify-style Node servers
- custom Node HTTP servers

The important requirement is not the framework name. It is that your server can
expose a **request-local** i18n instance before translated code runs.

## The Runtime Rule

Palamedes-transformed code calls `getI18n()` from `@palamedes/runtime`.

On the server, that means you must register a getter:

```ts
import { setServerI18nGetter } from "@palamedes/runtime"

setServerI18nGetter(() => getRequestScopedI18n())
```

In backend servers, the cleanest way to do that is `AsyncLocalStorage`.

## Canonical Node Pattern

```ts
import { createI18n, type CatalogMessages } from "@palamedes/core"
import { createServerI18nScope } from "@palamedes/runtime/server"

type Locale = "en" | "de"

const CATALOGS: Record<Locale, CatalogMessages> = {
  en: { "Welcome to Palamedes": "Welcome to Palamedes" },
  de: { "Welcome to Palamedes": "Willkommen bei Palamedes" },
}

const serverI18n = createServerI18nScope<ReturnType<typeof createI18n>>()

function createRequestI18n(locale: Locale) {
  const i18n = createI18n({ locale })
  i18n.load(locale, CATALOGS[locale])
  return i18n
}
```

For each incoming request:

1. determine the locale from `Accept-Language`, cookies, session, or user profile
2. create an i18n instance, load that locale's catalog, and activate it
3. run the request inside `serverI18n.run(i18n, ...)`

`createServerI18nScope()` is the Node `AsyncLocalStorage` implementation and
registers the runtime getter once. It gives transformed code and ordinary
runtime helpers inside the request path access to the correct server-local
instance.

The examples below deliberately use `getI18n()._(...)` rather than a macro.
That is a plain Node runtime call, so no Vite, SWC, or Babel transform is needed.
Use a macro only after configuring the corresponding transform in your server
build.

## Hono Example

Hono is a strong fit for this pattern because it keeps the request flow small
and explicit while still running on Node.js.

```ts
import { Hono } from "hono"
import { createI18n, type CatalogMessages } from "@palamedes/core"
import { defineLocaleControls } from "@palamedes/core/locale"
import { getI18n } from "@palamedes/runtime"
import { createServerI18nScope } from "@palamedes/runtime/server"

type Locale = "en" | "de"
const app = new Hono()
const localeControls = defineLocaleControls({
  locales: ["en", "de"],
  defaultLocale: "en",
})
const CATALOGS: Record<Locale, CatalogMessages> = {
  en: { "Welcome to Palamedes": "Welcome to Palamedes" },
  de: { "Welcome to Palamedes": "Willkommen bei Palamedes" },
}
const serverI18n = createServerI18nScope<ReturnType<typeof createI18n>>()

app.use(async (c, next) => {
  const locale = localeControls.preferredLocale(c.req.header("accept-language")) as Locale
  const i18n = createI18n({ locale })
  i18n.load(locale, CATALOGS[locale])

  await serverI18n.run(i18n, next)
})

app.get("/", (c) => {
  return c.text(getI18n()._("Welcome to Palamedes"))
})
```

This same pattern also works when the locale comes from:

- a signed cookie
- a session record
- a database-backed user profile
- a route segment or hostname

## Express Example

```ts
import express from "express"
import { createI18n, type CatalogMessages } from "@palamedes/core"
import { defineLocaleControls } from "@palamedes/core/locale"
import { getI18n } from "@palamedes/runtime"
import { createServerI18nScope } from "@palamedes/runtime/server"

type Locale = "en" | "de"
const app = express()
const localeControls = defineLocaleControls({
  locales: ["en", "de"],
  defaultLocale: "en",
})
const CATALOGS: Record<Locale, CatalogMessages> = {
  en: { "Welcome to Palamedes": "Welcome to Palamedes" },
  de: { "Welcome to Palamedes": "Willkommen bei Palamedes" },
}
const serverI18n = createServerI18nScope<ReturnType<typeof createI18n>>()

app.use((req, res, next) => {
  const locale = localeControls.preferredLocale(req.header("accept-language")) as Locale
  const i18n = createI18n({ locale })
  i18n.load(locale, CATALOGS[locale])

  serverI18n.run(i18n, next)
})

app.get("/", (req, res) => {
  res.send(getI18n()._("Welcome to Palamedes"))
})
```

## Where Locale Can Come From

Palamedes does not force a single backend locale strategy.

Common backend sources are:

- `Accept-Language`
- request cookies
- user session data
- stored user profile locale
- route or subdomain conventions

The important rule is only this:

determine the locale before translated code runs, then expose the matching i18n
instance through the runtime getter.

## What This Means For The Product Story

This matters for positioning because Palamedes covers more than frontend
framework tooling.

The same runtime model already covers:

- server-side code inside React frameworks
- request-local logic in backend applications
- APIs or HTML responses that need locale-aware output

That makes the cross-framework story stronger: the model is not tied only to UI
render trees. It also fits classic request/response servers.

## Related Docs

- [Root README](https://github.com/sebastian-software/palamedes/blob/main/README.md)
- [First working translation in 5 minutes](./first-working-translation.md)
- [Migration from Lingui](./migrate-from-lingui.md)
- [Example matrix](https://github.com/sebastian-software/palamedes/blob/main/examples/README.md)
