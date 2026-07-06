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
import { createI18n } from "@palamedes/core"
import { createRemixI18nRequestScope } from "@palamedes/remix/server"

export const remixI18n = createRemixI18nRequestScope((request) => {
  const i18n = createI18n()
  i18n.activate(request.headers.get("accept-language")?.startsWith("de") ? "de" : "en")
  return i18n
})
```

Use `remixI18n.run(request, callback)` inside Remix actions or middleware before
translated code runs.

## Current Scope

The first Remix v3 support path covers JS macros in server-loaded modules:
`t`, `msg`, `plural`, `select`, `selectOrdinal`, and `defineMessage`.

Rich JSX message macros remain experimental for Remix v3 because Remix's
default loader lowers JSX before the Palamedes register hook sees the module.
