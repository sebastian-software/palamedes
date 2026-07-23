# `@palamedes/remix`

`@palamedes/remix` is the server-first Remix v3 integration for Palamedes.

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
- `createRemixI18nServer(options)`
- `createRemixI18nRequestScope(resolveI18n)`
- `remixI18nContext`

## Register Options

```ts
interface PalamedesRemixRegisterOptions {
  include?: RegExp
  exclude?: RegExp
  runtimeModule?: string
}
```

Defaults:

- `include`: `/\.(tsx?|jsx?|mjs)$/`
- `exclude`: `/[/\\]node_modules[/\\]/`
- `runtimeModule`: `"@palamedes/runtime"`

The default intentionally excludes `.cjs` because the macro transform injects
ESM imports. Pass a custom `include` only if your hook also provides a
CommonJS-compatible runtime binding.

`.po` imports are claimed by the hook before Node's default loader runs. They
compile through the same catalog module path used by the Vite/Next integrations
and require a Palamedes config (`palamedes.yaml`, `palamedes.config.ts`, etc.).

## Server Request Scope

```ts
import type { CatalogMessages } from "@palamedes/core"
import { defineLocaleControls } from "@palamedes/core/locale"
import { createRemixI18nServer } from "@palamedes/remix/server"

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

export const remixI18n = createRemixI18nServer({
  locales,
  strategy: "cookie",
  loadMessages(locale) {
    return catalogs[locale]
  },
})
```

Use `remixI18n.run(context, callback)` inside Remix actions, or install
`remixI18n.middleware()` on a fetch-router. The helper resolves the active
locale, creates and activates a Palamedes i18n instance, caches catalog messages
by locale at module scope, and preserves that request-local instance while a
returned `Response.body` is streamed.

Supported strategies are `cookie`, `route`, `subdomain`, and `tld`. Route
strategy reads `context.params.locale` by default; pass `routeParam` to use a
different param name. Cookie serialization is available through
`remixI18n.serializeLocaleCookie(locale)`.

## Current Scope

The Remix v3 support path covers:

- JS macros in server-loaded modules: `t`, `plural`, `select`, and
  `selectOrdinal`
- request-local i18n activation for Fetch `Request` handlers
- cookie, route, subdomain, TLD, and `Accept-Language` locale negotiation
- `.po` catalog imports through `@palamedes/remix/register`
- module-scope catalog message caching before request activation

The register hook covers server-executed modules only. Browser-delivered Remix
v3 modules are compiled through Remix's asset pipeline, which does not expose a
Palamedes macro transform hook yet. The upstream tracking request is
[remix-run/remix#11580](https://github.com/remix-run/remix/issues/11580).

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
Track the Remix UI adapter, rich-message, and Frames follow-up in
[palamedes#357](https://github.com/sebastian-software/palamedes/issues/357).

## Migration From The Experimental Cookie Example

The earlier Remix cookie example kept demo catalogs inline and wired i18n
manually in the example controller. Move those pieces to the server-first setup:

1. Add `palamedes.yaml` and checked-in `.po` catalog files.
2. Import catalog `messages` from `.po` files and load them through
   `createRemixI18nServer({ loadMessages })`.
3. Replace per-route manual locale activation with `remixI18n.run(context, ...)`
   or `remixI18n.middleware()`.
4. Keep the Node command order as
   `node --import remix/node-tsx --import @palamedes/remix/register server.ts`.

## Tested Beta

The Remix examples are pinned to `remix@3.0.0-beta.5`. Keep the examples pinned
to the exact beta that `pnpm verify:examples:smoke -- --framework remix`
validates. A separate `remix@next` canary run is useful for detecting beta churn,
but it should not replace the pinned-version smoke gate.
