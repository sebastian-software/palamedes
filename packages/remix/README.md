# @palamedes/remix

Experimental Remix v3 integration for Palamedes.

Use this package with Remix v3's default Node loader path. Register Remix's TSX
loader first, then Palamedes:

```sh
node --import remix/node-tsx --import @palamedes/remix/register server.ts
```

The order is load-bearing. If `@palamedes/remix/register` is registered before
`remix/node-tsx`, Remix short-circuits the TS/TSX load and Palamedes macros can
reach runtime as untransformed stubs.

The register hook composes with `remix/node-tsx`, receives the JavaScript source
that Remix compiled from `.ts` and `.tsx` files, and runs the Palamedes macro
transform before Node executes the module.

## Scope

This first integration supports JavaScript macros such as `t`, `msg`, `plural`,
`select`, `selectOrdinal`, and `defineMessage` in server-loaded Remix modules.

The hook only reaches server-executed modules. Browser-delivered Remix v3 modules
are compiled by Remix's asset pipeline, which does not currently expose a script
transform hook for Palamedes macros.

Rich JSX message macros are still experimental for Remix v3 because Remix's
loader lowers JSX to `remix/ui/jsx-runtime` calls before this hook runs.

## Runtime Cost

Remix v3 intentionally has no build step: `remix/node-tsx` reads and lowers
every `.ts`, `.tsx`, and `.jsx` module through `oxc-transform` when the process
starts, in development and production alike. The Palamedes hook joins that
existing pipeline instead of adding a new one, and Palamedes' native macro
transform is built on the same OXC infrastructure Remix itself uses.

In practice:

- Modules without Palamedes macro imports are skipped after a fast substring
  scan of source that is already in memory.
- Modules with macros run through the native transform once, at module load
  time. Macro call sites are patched in place; files are not re-printed.
- After startup there is no per-request transform work. Requests execute plain
  runtime calls against compiled catalogs — the same code shape the build-time
  integrations (`@palamedes/vite-plugin`, `@palamedes/next-plugin`) produce.

The transform cost moves from build time to process start, stays proportional
to the number of macro-containing modules, and recurs per cold start. That is
the same tradeoff Remix makes for its own TypeScript and JSX lowering, so
steady-state request performance matches the build-time integrations.

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
