# @palamedes/remix

Server-first Remix v3 integration for Palamedes.

## Installation

```sh
pnpm add @palamedes/core @palamedes/remix @palamedes/runtime remix
```

`@palamedes/core` must be a direct runtime dependency because generated catalog
modules import `defineCompiledCatalog()` from its `compiled` entrypoint.

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

| Area                                                 | Status                                                                      |
| ---------------------------------------------------- | --------------------------------------------------------------------------- |
| JS macros (`t`, `plural`, `select`, `selectOrdinal`) | Supported in server-loaded modules                                          |
| `.po` catalog imports                                | Supported through the Palamedes register hook                               |
| Request-local i18n                                   | Supported through `createRemixI18nServer()` and middleware/request helpers  |
| Locale strategies                                    | Cookie, route, subdomain, and TLD examples are covered by smoke tests       |
| Server-rendered Remix UI Frames                      | Supported; document and direct frame requests retain their own locale scope |
| Rich JSX messages                                    | Not supported; the React `Trans` runtime is incompatible with Remix UI      |
| Browser/client modules                               | Not supported yet; Remix's asset pipeline has no script transform hook      |

The hook only reaches server-executed modules. Browser-delivered Remix v3 modules
are compiled by Remix's asset pipeline, which does not currently expose a script
transform hook for Palamedes macros. The upstream tracking request is
[remix-run/remix#11580](https://github.com/remix-run/remix/issues/11580).

## Remix UI, Frames, and Rich Messages

Remix UI Frames are supported on the server. Render both the document and the
frame endpoint inside `remixI18n.run()` so a streamed frame and a later,
client-initiated frame reload independently resolve the same request locale:

```tsx
import { Frame } from "remix/ui"
import { renderToStream } from "remix/ui/server"

function renderDocument(request: Request, locale: string) {
  return renderToStream(
    <html lang={locale}>
      <body>
        <Frame name="locale-summary" src="/frames/locale-summary" fallback={<p>Loading…</p>} />
      </body>
    </html>,
    {
      frameSrc: request.url,
      signal: request.signal,
      resolveFrame: () => renderLocaleSummary(),
    }
  )
}
```

The cookie example exercises both `/frames` and `/frames/locale-summary` with
German translations. Use ordinary JavaScript macros such as `t` inside Remix UI
components; those calls remain visible to the server loader after JSX lowering.

Rich JSX macros such as `<Trans>` are not supported in Remix UI. This is a
specific runtime boundary, rather than an untested adapter: `remix/node-tsx`
lowers JSX to `remix/ui/jsx-runtime` before the Palamedes loader receives a
module. Palamedes' rich-message transform requires the original JSX tree to
derive message placeholders, and its compiled `@palamedes/react` `Trans`
component produces React elements, while Remix UI renders its own element
model. A supported adapter therefore needs both a pre-lowering transform hook
and a dedicated Remix UI rich-message runtime; neither is a public Remix API
today. Browser/client macro parity is separately blocked on the
[asset-pipeline transform hook](https://github.com/remix-run/remix/issues/11580).

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

The register hook preserves source-message fallbacks in development and strips
them in production. Create a custom hook with
`createPalamedesRemixLoadHook({ keepSourceFallbacks: true })` when production
server code must retain readable source fallbacks.

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
