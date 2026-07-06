# @palamedes/remix

Server-first Remix v3 integration for Palamedes.

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

This integration is tested against `remix@3.0.0-beta.5` and supports
server-loaded Remix modules:

| Area                                                                         | Status                                                                        |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| JS macros (`t`, `msg`, `plural`, `select`, `selectOrdinal`, `defineMessage`) | Supported in server-loaded modules                                            |
| `.po` catalog imports                                                        | Supported through the Palamedes register hook                                 |
| Request-local i18n                                                           | Supported through `createRemixI18nServer()` and middleware/request helpers    |
| Locale strategies                                                            | Cookie, route, subdomain, and TLD examples are covered by smoke tests         |
| Rich JSX messages                                                            | Not supported yet; Remix lowers JSX before the Palamedes hook sees the source |
| Browser/client modules                                                       | Not supported yet; Remix's asset pipeline has no script transform hook        |

The hook only reaches server-executed modules. Browser-delivered Remix v3 modules
are compiled by Remix's asset pipeline, which does not currently expose a script
transform hook for Palamedes macros. The upstream tracking request is
[remix-run/remix#11580](https://github.com/remix-run/remix/issues/11580).

Rich JSX message macros are still experimental for Remix v3 because Remix's
loader lowers JSX to `remix/ui/jsx-runtime` calls before this hook runs. The
follow-up for a Remix UI adapter, rich messages, and Frames is
[palamedes#357](https://github.com/sebastian-software/palamedes/issues/357).

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
request and cache compiled catalog modules at module scope:

```ts
import { createRemixI18nServer } from "@palamedes/remix/server"

export const remixI18n = createRemixI18nServer({
  locales,
  strategy: "cookie",
  loadMessages,
})

export default createController(routes, {
  actions: {
    home(context) {
      return remixI18n.run(context, ({ locale }) => context.render(<HomePage locale={locale} />))
    },
  },
})
```

`createRemixI18nRequestScope()` remains available for lower-level integrations.
Both APIs preserve the active i18n scope while a returned `Response.body` is
streamed, so translated code that executes during body consumption still sees
the same request-local i18n instance.

## Beta Tracking

The examples pin Remix to the exact beta version they are tested against. Bumps
to newer betas should update the example `package.json` files together, run:

```sh
pnpm verify:examples:smoke -- --framework remix
```

For early warning, maintainers can run the same smoke command after temporarily
overriding the examples to `remix@next`; failures should be treated as
non-blocking canary signal unless the pinned beta also fails.

## License

[![Sebastian Software](https://sebastian-brand.vercel.app/sebastian-software/logo-software.svg)](https://oss.sebastian-software.com/)

MIT © 2026 Sebastian Software
