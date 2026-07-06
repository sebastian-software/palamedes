# @palamedes/remix

Experimental Remix v3 integration for Palamedes.

Use this package with Remix v3's default Node loader path. Register Remix's TSX
loader first, then Palamedes:

```sh
node --import remix/node-tsx --import @palamedes/remix/register server.ts
```

The register hook composes with `remix/node-tsx`, receives the JavaScript source
that Remix compiled from `.ts` and `.tsx` files, and runs the Palamedes macro
transform before Node executes the module.

## Scope

This first integration supports JavaScript macros such as `t`, `msg`, `plural`,
`select`, `selectOrdinal`, and `defineMessage` in server-loaded Remix modules.

Rich JSX message macros are still experimental for Remix v3 because Remix's
loader lowers JSX to `remix/ui/jsx-runtime` calls before this hook runs.

## Server Runtime Scope

Use `@palamedes/remix/server` to bind translated server code to the active
request:

```ts
import { createI18n } from "@palamedes/core"
import { createRemixI18nRequestScope } from "@palamedes/remix/server"

export const remixI18n = createRemixI18nRequestScope((request) => {
  const i18n = createI18n()
  i18n.activate(request.headers.get("accept-language")?.startsWith("de") ? "de" : "en")
  return i18n
})

export default createController(routes, {
  actions: {
    home(context) {
      return remixI18n.run(context.request, () => context.render(<HomePage />))
    },
  },
})
```

## License

[![Sebastian Software](https://sebastian-brand.vercel.app/sebastian-software/logo-software.svg)](https://oss.sebastian-software.com/)

MIT © 2026 Sebastian Software
