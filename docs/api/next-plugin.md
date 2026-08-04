# `@palamedes/next-plugin`

`@palamedes/next-plugin` wires Palamedes macro transformation and `.po` loading
into Next.js.

Catalog storage can be PO or FCL in `palamedes.yaml`, but this API is still a
`.po` import loader. See [Catalog formats](../catalog-formats.md) for the
storage/import boundary.

## Exports

- `withPalamedes(baseConfig?, options?)`
- default export `withPalamedes`
- `WithPalamedesOptions`
- internal loader subpaths used by plugin wiring:
  `@palamedes/next-plugin/palamedes-loader` and
  `@palamedes/next-plugin/palamedes-po-loader`

## Options

```ts
interface WithPalamedesOptions {
  include?: RegExp
  exclude?: RegExp
  enablePoLoader?: boolean
  configPath?: string
  failOnMissing?: boolean
  failOnCompileError?: boolean
  runtimeModule?: string
  keepSourceFallbacks?: boolean
  workspaceRoot?: string
}
```

Defaults:

- `include`: `/\.[jt]sx?$/`
- `exclude`: `/node_modules/`
- `enablePoLoader`: `true`
- `failOnMissing`: `false`
- `failOnCompileError`: `false`
- `runtimeModule`: `"@palamedes/runtime"`
- `keepSourceFallbacks`: `true` in development, `false` in production

## Usage

```js
const { withPalamedes } = require("@palamedes/next-plugin")

module.exports = withPalamedes({})
```

## App Router Client Catalog Boundary

After resolving and activating the request-local server i18n instance, wrap
translated Client Components in a boundary created by the shared React runtime:

```tsx
// src/components/ClientCatalogBoundary.tsx
"use client"

import { createClientCatalogBoundary } from "@palamedes/react/client"

export const ClientCatalogBoundary = createClientCatalogBoundary<"en" | "de">({
  loadCatalog: (locale) => import(`../locales/${locale}.po`),
  resolveClientLocale: () => {
    const locale = document.documentElement.lang
    if (locale !== "en" && locale !== "de") throw new Error(`Unsupported locale: ${locale}`)
    return locale
  },
})
```

```tsx
// app/page.tsx (Server Component)
const { locale } = await createActiveServerI18n()

return (
  <ClientCatalogBoundary locale={locale}>
    <TranslatedClientContent />
  </ClientCatalogBoundary>
)
```

The dynamic import is the serialization boundary: generated messages remain
executable module code and only the active locale chunk loads in the browser.
React suspends hydration until it is ready, so hook-free translated consumers
see the catalog on their first render. The shared client runtime is initialized
once before descendants render. Changing locale requires a document navigation;
the boundary rejects a prop that differs from the resolved document locale.

No inline script, `eval`, JSON serialization, or application-owned i18n proxy
is involved. This keeps the bootstrap compatible with strict CSP and the
parser-free generated catalog representation.

Palamedes intentionally provides no in-document locale-switching mode. See
[Locale strategies](../locale-strategies.md#unsupported-root-key-escape-hatch)
for the unsupported root-key escape hatch and its limitations.

Production output strips authored messages from generated runtime calls by
default and therefore requires compiled catalogs to be loaded before translated
code renders. It also omits translator comments and context metadata from
runtime descriptors. Set `keepSourceFallbacks: true` when production must
retain readable source-message fallbacks. The option is forwarded identically
to the Turbopack and webpack transform loaders.

The plugin configures both Turbopack and webpack paths, and requires Next.js
16 (`peerDependencies: next ^16` — the emitted top-level `turbopack.rules`
conditions and `outputFileTracingRoot` need the Next 16 config surface).
`include` and `exclude` apply under both bundlers: in the webpack branch as
loader `test`/`exclude`, under Turbopack translated into the rule condition
(`{ path: include }` plus `{ not: { path: exclude } }`).

The regex is not matched against the same string in both cases. Webpack tests
the absolute resource path (`/home/me/app/src/page.tsx`); Turbopack tests its
own internal path representation for the module, which is not guaranteed to be
that absolute OS path. Extension patterns (`/\.[jt]sx?$/`) and path-segment
patterns (`/[/\\]generated[/\\]/`) behave the same under both. Patterns
anchored with `^`, or built from an absolute directory, are the ones that can
match under webpack and silently miss under Turbopack — prefer segment-based
patterns and verify under both bundlers before relying on one.

The `.po` loader is scoped to first-party catalogs under both bundlers —
`{ not: "foreign" }` for Turbopack, `exclude: /node_modules/` for webpack — so
a dependency shipping importable `.po` files does not fail the build with an
unmatched-catalog error.

User-supplied `turbopack.rules` for the same glob are preserved: the Palamedes
rules are appended to the glob's rule list instead of overwriting it. A user
value written in the loader shorthand (`"*": ["my-loader"]`) is first wrapped
into the equivalent rule config (`{ loaders: ["my-loader"] }`), because a list
mixing bare loaders with rule configs has no defined meaning.

`workspaceRoot` can be set explicitly in monorepos when automatic root
detection is not correct.
