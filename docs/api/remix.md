# `@palamedes/remix`

`@palamedes/remix` is the experimental Remix v3 integration for Palamedes.

It targets Remix v3's default Node loader model rather than Vite. Register
Remix's TSX loader first, then Palamedes:

```sh
node --import remix/node-tsx --import @palamedes/remix/register server.ts
```

Register `remix/node-tsx` first. If the order is reversed, Remix's loader
short-circuits TS/TSX loading before the Palamedes hook can transform macros.

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
- `exclude`: `/[/\\]node_modules[/\\]/`
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

The register hook covers server-executed modules only. Browser-delivered Remix
v3 modules are compiled through Remix's asset pipeline, which does not expose a
Palamedes macro transform hook yet.

## Runtime Cost

Remix v3 runs its loader hooks in development and production alike; there is no
build step. The Palamedes hook joins that pipeline: modules without macro
imports are skipped after a substring scan, macro-containing modules are patched
once at module load time by the native OXC-based transform, and requests execute
plain runtime calls with no per-request transform work. The cost moves from
build time to process start and recurs per cold start — the same tradeoff Remix
makes for its own TypeScript and JSX lowering via `oxc-transform`.

Rich JSX message macros remain experimental for Remix v3 because Remix's
default loader lowers JSX before the Palamedes register hook sees the module.
