# Palamedes In Backend Servers

Palamedes is not limited to React frameworks.

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
import { AsyncLocalStorage } from "node:async_hooks"
import { createI18n } from "@palamedes/core"
import { setServerI18nGetter } from "@palamedes/runtime"

const i18nStorage = new AsyncLocalStorage<ReturnType<typeof createI18n>>()

setServerI18nGetter(() => i18nStorage.getStore())
```

For each incoming request:

1. determine the locale from `Accept-Language`, cookies, session, or user profile
2. create or hydrate the i18n instance for that locale
3. run the request inside `i18nStorage.run(i18n, ...)`

That gives any translated code inside the request path access to the correct
server-local instance.

## Hono Example

Hono is a strong fit for this pattern because it keeps the request flow small
and explicit while still running on Node.js.

```ts
import { AsyncLocalStorage } from "node:async_hooks"
import { Hono } from "hono"
import { createI18n } from "@palamedes/core"
import { setServerI18nGetter } from "@palamedes/runtime"
import { getPreferredLocale } from "@palamedes/example-locale-shared"

const app = new Hono()
const i18nStorage = new AsyncLocalStorage<ReturnType<typeof createI18n>>()

setServerI18nGetter(() => i18nStorage.getStore())

app.use(async (c, next) => {
  const locale = getPreferredLocale(c.req.header("accept-language"))
  const i18n = createI18n()

  i18n.activate(locale)

  await i18nStorage.run(i18n, next)
})

app.get("/", (c) => {
  return c.text(renderLocalizedMessage())
})
```

This same pattern also works when the locale comes from:

- a signed cookie
- a session record
- a database-backed user profile
- a route segment or hostname

## Express Example

```ts
import { AsyncLocalStorage } from "node:async_hooks"
import express from "express"
import { createI18n } from "@palamedes/core"
import { setServerI18nGetter } from "@palamedes/runtime"

const app = express()
const i18nStorage = new AsyncLocalStorage<ReturnType<typeof createI18n>>()

setServerI18nGetter(() => i18nStorage.getStore())

app.use((req, res, next) => {
  const i18n = createI18n()

  i18n.activate(resolveLocaleFromRequest(req))
  i18nStorage.run(i18n, next)
})

app.get("/", (req, res) => {
  res.send(renderLocalizedMessage())
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

This matters for positioning because Palamedes is not only “for frontend
framework adapters.”

The same runtime model already covers:

- server-side code inside React frameworks
- request-local logic in backend applications
- APIs or HTML responses that need locale-aware output

That makes the cross-framework story stronger: the model is not tied only to UI
render trees. It also fits classic request/response servers.

## Related Docs

- [Root README](https://github.com/sebastian-software/palamedes/blob/main/README.md)
- [First working translation in 5 minutes](https://github.com/sebastian-software/palamedes/blob/main/docs/first-working-translation.md)
- [Migration from Lingui](https://github.com/sebastian-software/palamedes/blob/main/docs/migrate-from-lingui.md)
- [Example matrix](https://github.com/sebastian-software/palamedes/blob/main/examples/README.md)
