# `@palamedes/remix`

`@palamedes/remix` is the experimental Remix v3 integration for Palamedes.

It targets Remix v3's default Node loader model rather than Vite. Register
Remix's TSX loader first, then Palamedes:

```sh
node --import remix/node-tsx --import @palamedes/remix/register server.ts
```

## Exports

- `createPalamedesRemixLoadHook(options?)`
- `@palamedes/remix/register`
- `@palamedes/remix/server`
- `createRemixI18nRequestScope(resolveI18n)`

## Register Options

```ts
interface PalamedesRemixRegisterOptions {
  include?: RegExp
  exclude?: RegExp
  runtimeModule?: string
}
```

Defaults:

- `include`: `/\.(tsx?|jsx?|mjs|cjs)$/`
- `exclude`: `/node_modules/`
- `runtimeModule`: `"@palamedes/runtime"`

## Server Request Scope

```ts
import { createI18n, type CatalogMessages } from "@palamedes/core"
import { defineLocaleControls } from "@palamedes/core/locale"
import { createRemixI18nRequestScope } from "@palamedes/remix/server"

const locales = defineLocaleControls({
  locales: ["en", "de"],
  defaultLocale: "en",
  cookies: { locale: "locale" },
})

const catalogs: Record<"en" | "de", CatalogMessages> = {
  en: {},
  de: {
    // Load compiled catalog messages for real apps.
  },
}

export const remixI18n = createRemixI18nRequestScope((request) => {
  const resolved = locales.resolve({
    strategy: "cookie",
    acceptLanguageHeader: request.headers.get("accept-language"),
    cookieHeader: request.headers.get("cookie"),
  })
  const i18n = createI18n()
  i18n.load(resolved.locale, catalogs[resolved.locale])
  i18n.activate(resolved.locale)
  return i18n
})
```

Use `remixI18n.run(request, callback)` inside Remix actions or middleware before
translated code runs. The example under `examples/remix-cookie` also shows a
POST route that sets the locale cookie and re-renders through the request-local
catalog.

## Current Scope

The first Remix v3 support path covers:

- JS macros in server-loaded modules: `t`, `msg`, `plural`, `select`,
  `selectOrdinal`, and `defineMessage`
- request-local i18n activation for Fetch `Request` handlers
- cookie and `Accept-Language` locale negotiation
- catalog loading before each translated server render

Rich JSX message macros remain experimental for Remix v3 because Remix's
default loader lowers JSX before the Palamedes register hook sees the module.
