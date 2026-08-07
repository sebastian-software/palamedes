# @palamedes/next-plugin

[![npm version](https://img.shields.io/npm/v/%40palamedes%2Fnext-plugin?logo=npm)](https://www.npmjs.com/package/@palamedes/next-plugin)
[![CI](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml)
[![Sponsored by Sebastian Software](https://img.shields.io/badge/Sponsored%20by-Sebastian%20Software-0f172a.svg)](https://oss.sebastian-software.com/)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f172a.svg)](https://github.com/sebastian-software/palamedes/blob/main/LICENSE)

The recommended Palamedes entry point for Next.js applications.

`@palamedes/next-plugin` wires Palamedes into Next.js so message macros are
compiled before they leak into runtime, `.po` files load as part of the build,
and catalog problems show up while the app is still easy to fix.

## Status

- Recommended for Next.js applications using App Router and Palamedes macros
- Supports `.po` imports and source-string-first catalog semantics
- Reports missing translations and ICU compatibility diagnostics during builds
- Requires Next.js 16 (`peerDependencies: next ^16`); the emitted top-level
  `turbopack.rules` conditions and `outputFileTracingRoot` need the Next 16
  config surface
- Uses Turbopack as the verified default path on Next.js 16.2
- Graph-split client messages are verified under Turbopack and webpack
- The shipped example proves server rendering, localized `"use server"`
  actions, hydration, and client navigation
- Also supports webpack as an opt-out / fallback path
- Not a full Next.js starter or scaffolding tool

## Start Here

Use the full copy-paste setup guide:

- [First working translation in 5 minutes](https://github.com/sebastian-software/palamedes/blob/main/docs/first-working-translation.md)

## Installation

```bash
pnpm add @palamedes/core @palamedes/react @palamedes/runtime @palamedes/next-plugin
pnpm add -D @palamedes/cli @palamedes/config
```

## Minimal Setup

```js
const { withPalamedes } = require("@palamedes/next-plugin")

module.exports = withPalamedes({})
```

```yaml
locales: [en, de]
source-locale: en
catalogs:
  - path: src/locales/{locale}
    include: [src]
```

Transformed code expects `getI18n()` from `@palamedes/runtime`, so make sure the active i18n instance is available on both the client and the server before translated code executes.

For translated Client Components using PO catalogs, enable
`messageSplitting: true`. Palamedes then owns the browser bootstrap: it loads
only the document locale's fragments for Client Components and helpers that are
actually present in the evaluated module graph. No application-owned catalog
boundary, executable RSC payload, or inline script is required.

Catalog storage can be PO or FCL in `palamedes.yaml`, but the current Next
loader is still a `.po` import loader. Keep direct app imports on `.po` unless a
future adapter release explicitly documents `.fcl` imports.

For App Router Server Components on the Node runtime, use a server-only module
with `@palamedes/next-plugin/server`. This follows the official RSC shape: keep
server code behind `server-only`, memoize request work with React `cache()`, and
bind direct macro calls to the complete Next render lifetime.

```ts
// src/lib/i18n.server.ts
import "server-only"

import { cache } from "react"
import { createNextServerI18nScope } from "@palamedes/next-plugin/server"
import type { PalamedesI18n } from "@palamedes/core"

export const serverI18n = createNextServerI18nScope<PalamedesI18n>()

const loadActiveServerI18n = cache(async () => {
  const locale = await resolveLocaleFromCookiesOrHeaders()
  const i18n = await loadI18n(locale)
  return { i18n, locale }
})

export async function createActiveServerI18n() {
  const active = await loadActiveServerI18n()
  serverI18n.activate(active.i18n)
  return active
}
```

```tsx
// app/page.tsx
import { t } from "@palamedes/core/macro"
import { createActiveServerI18n } from "@/lib/i18n.server"

function DownstreamServerTitle() {
  return <h1>{t`Welcome to Palamedes`}</h1>
}

export default async function Page() {
  const { locale } = await createActiveServerI18n()
  return (
    <>
      <DownstreamServerTitle />
      <TranslatedClientContent locale={locale} />
    </>
  )
}
```

Enable the client graph bootstrap once in the Next configuration:

```js
module.exports = withPalamedes(
  {},
  {
    messageSplitting: true,
  }
)
```

Each message-bearing browser module gets statically enumerable imports for its
selected PO subset. It awaits only the import matching
`document.documentElement.lang`, loads the fragment into a shared parser-free
instance, and only then evaluates that module body or resolves it to an
importer. Turbopack and webpack therefore omit inactive locale catalogs and
unvisited route messages from network requests. Locale changes require a
document navigation.

Eager translation calls must execute inside a function, method, or callback
after i18n activation. Palamedes rejects eager macros at module scope, and
declarations that defer translation until component render remain valid. The
client bootstrap also initializes the module's own fragment before its body, so
custom compiled-adapter calls observe that fragment if they must run eagerly.

Selected `.po` imports remain normal development dependencies. Catalog edits
invalidate their affected subsets under Turbopack and webpack; Next may apply
Fast Refresh or fall back to a full document reload at an async-module
boundary. A document reload is the supported fallback.

`messageSplitting` currently supports PO catalogs and defaults to `false` for
compatibility. Keep using `createClientCatalogBoundary()` from
`@palamedes/react/client` when an app needs a complete active-locale catalog or
a custom loading strategy. Parser-free split apps should author client messages
with macros or compiled adapters; raw ICU strings passed to compatibility
runtime components still require the full parser.

Create one Next server scope at module level and activate a fresh i18n instance
during request-local server initialization. Its lifetime is the complete App
Router render, including the RSC pass, Client Component server prerender, and
React suspension/resumption. Next render objects are held as weak request keys;
there is no process-global "last request" instance to leak another locale.

Do not call `setServerI18nGetter()` inside every Server Component render. Use
`serverI18n.run(i18n, callback)` only for tightly scoped helper callbacks. Use
the generic `createServerI18nScope()` from `@palamedes/runtime/server` for
classic Node request handlers outside Next. Both server subpaths are Node-only,
so keep them out of Client Components and Edge runtime code.

The Next render-lifetime adapter supports the package's declared Next 16 peer
range and is verified against Next 16.2. It intentionally binds to Next's
server render storage because public React async context does not span both
App Router render passes. If a future Next 16 release removes that server
storage module, the import fails during the application build instead of
silently falling back to stale or cross-request i18n state; upgrade Palamedes
before adopting that Next release.

References: [Next.js Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components), [Next.js data fetching and request-scoped React cache](https://nextjs.org/docs/app/getting-started/fetching-data), and [React `cache`](https://react.dev/reference/react/cache).

### Server Functions and Actions

A Server Function starts a separate request, so initialization performed while
rendering a page does not cover it. Add a conventional server entry module in
the project root or `src` directory:

```ts
// src/palamedes.server.ts
import { createI18n } from "@palamedes/core/compiled"
import { getLocale, serverI18nScope } from "./lib/i18n.server"

export async function initializeServerFunctionI18n(): Promise<void> {
  const { locale } = await getLocale()
  const i18n = createI18n()
  i18n.activate(locale)
  serverI18nScope.activate(i18n)
}
```

Then opt into automatic initialization with a flag:

```js
const { withPalamedes } = require("@palamedes/next-plugin")

module.exports = withPalamedes(
  {},
  {
    serverFunctions: true,
  }
)
```

Palamedes instruments directive-visible async functions: direct exports and
locally declared named exports in a module with a top-level `"use server"`
directive, async callbacks nested in an exported initializer such as
`export const save = withAuth(async () => ...)`, and async functions with their
own `"use server"` directive. It injects one initializer import per module and
awaits the initializer after the function's directive prologue. This also
covers actions without a local macro; sync and async helper calls then inherit
the initialized request scope.

A re-export such as `export { save } from "./save"` has no function body to
instrument at the re-export site. Put `"use server"` in the implementation
module or on the implementation function itself. Exported wrappers can pass a
module-local `async function` or `const` async arrow/function callback by
reference (including through nested wrappers). A wrapper that only receives an
imported callback still has no local async body for Palamedes to instrument, so
mark that callback's implementation explicitly.

The initializer belongs to the application. It should resolve the request
locale, create and activate a fresh request-local i18n instance, and be
request-memoized or otherwise idempotent. It does not load a whole locale
catalog: for each message-bearing server module, the transform registers one
lazy import per locale containing only that module's compiled ids. Static ESM
imports naturally bring along registrations from transitive helpers. After the
application initializer activates its instance, Palamedes imports only the
active locale's registered fragments and loads them into that instance.

Registration must happen before the initializer runs to affect the current
request. A module first reached through a dynamic import inside the action body
registers its fragments too late for that invocation; those registrations are
available to subsequent requests. Keep translating helpers in the static ESM
dependency graph, or load their messages explicitly before translating during
the first request.

Generated locale imports are deduplicated across concurrent and later requests
by the server module runtime. The request-local `load()` calls still merge each
fragment into the fresh instance; they scale with the messages represented in
the currently evaluated server graph rather than with the complete locale
catalog. The plugin resolves exactly one `palamedes.server` module from the
project root or `src` directory and keeps its absolute import address internal.

Registration follows module evaluation, not a per-action bundler manifest. A
long-lived server runtime can therefore retain registrations from more than one
action graph, so a later action may load a superset of its own dependency
closure. This affects the upper performance bound, not lookup correctness:
Palamedes still imports only the active locale and only the selected ids from
each registered source module.

Parameter defaults execute before the function body. Palamedes therefore
rejects eager macros in Server Function parameter initializers, including
nested destructuring defaults. Move such defaults into the body and preserve
JavaScript default-parameter semantics explicitly:

```ts
export async function save(message?: string) {
  "use server"
  if (message === undefined) message = t`Fallback`
}
```

Do not replace this guard with `??=` unless `null` should also select the
fallback. Server Function instrumentation is opt-in and currently targets the
Next.js integration.

## Options

```js
const { withPalamedes } = require("@palamedes/next-plugin")

module.exports = withPalamedes(
  {},
  {
    include: /\.(tsx?|jsx?)$/,
    exclude: /node_modules/,
    enablePoLoader: true,
    configPath: "./palamedes.yaml",
    failOnMissing: false,
    failOnCompileError: false,
    keepSourceFallbacks: undefined,
    workspaceRoot: undefined,
    serverFunctions: true,
    messageSplitting: true,
  }
)
```

`keepSourceFallbacks` defaults to `true` in development and `false` in
production. Production output therefore relies on loaded compiled catalogs and
does not duplicate authored source messages in transformed modules. Set the
option explicitly when readable runtime fallbacks are required in production.

`include` and `exclude` select which sources are macro-transformed, and apply
under both bundlers: webpack uses them as the loader's `test`/`exclude`, and
Turbopack receives them as `{ path: include }` plus `{ not: { path: exclude } }`
in the rule condition.

The two bundlers do not match the same string, so a regex that is anchored to a
directory layout can behave differently:

- webpack tests the **absolute resource path** (`/home/me/app/src/page.tsx`)
- Turbopack tests **its own internal path representation** for the module,
  which is not guaranteed to be that absolute OS path

Patterns matching a file extension (`/\.[jt]sx?$/`) or a path segment
(`/[/\\]generated[/\\]/`) work the same under both. Patterns anchored with `^`,
or built from an absolute directory, are the ones that can match under webpack
and silently miss under Turbopack — prefer segment-based patterns and verify
under both bundlers before relying on one. Both bundlers skip dependencies by
default: `exclude` defaults to `/node_modules/`, and the Turbopack rule also
carries `{ not: "foreign" }`.

The `.po` loader is scoped the same way. It is registered with
`{ not: "foreign" }` under Turbopack and `exclude: /node_modules/` under
webpack, so a dependency that ships importable `.po` files is left alone
instead of failing the build as an unmatched catalog.

`workspaceRoot` pins the monorepo root used for Turbopack and output file
tracing. When omitted, `withPalamedes` walks upward from the working directory
looking for workspace markers (`workspaces` in package.json,
`pnpm-workspace.yaml`, `turbo.json`, or `.git`) and — when it finds one — sets
`outputFileTracingRoot` and `turbopack.root` on the Next config as a side
effect. Pass `workspaceRoot` explicitly if that detection picks the wrong
directory.

## What This Package Handles

- transforms supported message macros in JavaScript and TypeScript sources
- compiles imported `.po` files into JavaScript modules
- keeps source-string-first catalog semantics aligned with the native core
- reports placeholder and ICU compatibility diagnostics from the native catalog compiler
- integrates with both webpack and Turbopack

## Related Docs

- [Proof, benchmarks, and current maturity](https://github.com/sebastian-software/palamedes/blob/main/docs/proof-and-benchmarks.md)
- [Troubleshooting common setup failures](https://github.com/sebastian-software/palamedes/blob/main/docs/troubleshooting.md)
- [Migration from Lingui](https://github.com/sebastian-software/palamedes/blob/main/docs/migrate-from-lingui.md)
- [Examples](https://github.com/sebastian-software/palamedes/blob/main/examples/README.md)

## License

[![Sebastian Software](https://sebastian-brand.vercel.app/sebastian-software/logo-software.svg)](https://oss.sebastian-software.com/)

MIT © 2026 Sebastian Software
