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
  await createActiveServerI18n()
  return <DownstreamServerTitle />
}
```

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
    runtimeModule: "@palamedes/runtime",
  }
)
```

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
