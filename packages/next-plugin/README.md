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
- The shipped example proves both server-rendered i18n and localized `"use server"` action output
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

For translated Client Components in the recommended reload model, pair the
request-local server setup below with `createReloadClientCatalogBoundary()`
from `@palamedes/react/client`. The boundary loads only the document's generated
catalog module and initializes the plain getter before descendants hydrate. It
does not serialize executable catalog functions or require an inline script.

Catalog storage can be PO or FCL in `palamedes.yaml`, but the current Next
loader is still a `.po` import loader. Keep direct app imports on `.po` unless a
future adapter release explicitly documents `.fcl` imports.

For App Router Server Components on the Node runtime, use a server-only module
with `@palamedes/runtime/server`. This follows the official RSC shape: keep
server code behind `server-only`, memoize request work with React `cache()`, and
bind direct macro calls to the active request scope while rendering.

```ts
// src/lib/i18n.server.ts
import "server-only"

import { cache } from "react"
import { createServerI18nScope } from "@palamedes/runtime/server"
import type { PalamedesI18n } from "@palamedes/core"

export const serverI18n = createServerI18nScope<PalamedesI18n>()

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
    <ClientCatalogBoundary locale={locale}>
      <DownstreamServerTitle />
      <TranslatedClientContent />
    </ClientCatalogBoundary>
  )
}
```

Create the boundary in a separate Client Component module so Next can see the
locale import context:

```tsx
"use client"

import { createReloadClientCatalogBoundary } from "@palamedes/react/client"

export const ClientCatalogBoundary = createReloadClientCatalogBoundary<"en" | "de">({
  loadCatalog: (locale) => import(`../locales/${locale}.po`),
  resolveClientLocale: () => {
    const locale = document.documentElement.lang
    if (locale !== "en" && locale !== "de") throw new Error(`Unsupported locale: ${locale}`)
    return locale
  },
})
```

Only `locale` crosses the RSC boundary. The generated catalog remains executable
module code in its own chunk, which preserves the parser-free runtime and lets
Turbopack omit inactive locale catalogs from the initial client bundle. Use
`localeSwitching: "live"` with `createClientCatalogBoundary()` only when locale
or catalog revisions intentionally change without a document navigation.

Do not call `setServerI18nGetter()` inside every Server Component render. Create
one server scope at module level, activate it during request-local server
initialization, and let downstream Server Components call macros normally. Use
`serverI18n.run(i18n, callback)` for tightly scoped helper callbacks or classic
Node request handlers. The `@palamedes/runtime/server` subpath imports Node
`async_hooks`, so keep it out of Client Components and Edge runtime code.

References: [Next.js Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components), [Next.js data fetching and request-scoped React cache](https://nextjs.org/docs/app/getting-started/fetching-data), and [React `cache`](https://react.dev/reference/react/cache).

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
    framework: "react",
    localeSwitching: "reload",
    keepSourceFallbacks: undefined,
    workspaceRoot: undefined,
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
