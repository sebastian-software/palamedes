# @palamedes/next-plugin

[![npm version](https://img.shields.io/npm/v/%40palamedes%2Fnext-plugin?logo=npm)](https://www.npmjs.com/package/@palamedes/next-plugin)
[![CI](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml)
[![Sponsored by Sebastian Software](https://img.shields.io/badge/Sponsored%20by-Sebastian%20Software-0f172a.svg)](https://oss.sebastian-software.com/)
[![License: MIT OR Apache-2.0](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-0f172a.svg)](https://github.com/sebastian-software/palamedes#license)

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
- Uses Turbopack as the verified default path on Next.js 16.3.4
- Graph-split client messages are verified under Turbopack and webpack
- The shipped example proves server rendering, localized `"use server"`
  actions, hydration, and client navigation
- Also supports webpack as an opt-out / fallback path
- Not a full Next.js starter or scaffolding tool

## Start Here

Use the full copy-paste setup guide:

- [First working translation with Next.js](https://github.com/sebastian-software/palamedes/blob/main/docs/nextjs-first-run.md)

## Installation

```bash
pnpm add @palamedes/core @palamedes/react @palamedes/runtime @palamedes/next-plugin server-only
pnpm add -D @palamedes/cli @palamedes/config
```

## Minimal Setup

```js
const { withPalamedes } = require("@palamedes/next-plugin");

module.exports = withPalamedes({});
```

```yaml
locales: [en, de]
source-locale: en
catalogs:
  - path: src/locales/{locale}
    include: [src]
```

`withPalamedes()` owns catalog delivery in development and production. The
application supplies locale policy and ordinary Next error views. PO catalogs
are compiled automatically; application catalog imports, loader maps, client
catalog boundaries, and import-map HTML are unnecessary.

For App Router Server Components on the Node runtime, use a server-only module:

```ts
// src/lib/i18n.server.ts
import "server-only";
import { cache } from "react";
import { createNextServerI18n } from "@palamedes/next-plugin/server";

export const createActiveServerI18n = cache(async () => {
  const locale = await resolveLocaleFromCookiesOrHeaders();
  return createNextServerI18n({ locale });
});
```

```tsx
// app/page.tsx
import { t } from "@palamedes/core/macro";
import { createActiveServerI18n } from "../lib/i18n.server";

export default async function Page() {
  await createActiveServerI18n();
  return <h1>{t`Welcome to Palamedes`}</h1>;
}
```

The adapter lazily imports the complete active server locale, prepares its
immutable catalog once per module generation, and attaches shared content to a
fresh request instance. `createNextServerI18n()` activates the scope for the
complete Next render, including suspension and Client Component server render.
`createNextServerI18nScope()` remains available for explicit scoped callbacks.
Server catalog or imported-config changes create a new generation; requests
already using earlier immutable content keep their view.

Set `<html lang={locale}>` from the same policy. To preserve a selected
formatting time zone on the client, also set
`data-palamedes-time-zone={timeZone}` on that element.

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

Selected `.po` imports remain normal development dependencies. Their
source-locale fallbacks and the Palamedes config are also registered as loader
dependencies, so catalog and fallback-policy edits invalidate the affected
subset under supported hosts. If a custom loader host does not implement
`addDependency()`, Palamedes emits one development warning; restart after
changing a fallback catalog or config in that host. Next may apply Fast Refresh
or fall back to a full document reload at an async-module boundary. A document
reload is the supported fallback. The development invalidation regression runs
under Turbopack. Webpack's top-level-await client build is covered in
production, but does not claim an equivalent HMR contract.

A failed required fragment prevents dependent module evaluation in every
environment. Runtime misses also throw. Keep ordinary Next `error.tsx` and
`global-error.tsx` views independent of catalogs and show generic copy. Offer a
full document reload: rejected module imports may remain cached, so a boundary
reset alone cannot guarantee recovery. Compiled translation fallbacks are
resolved during the build and remain independent of delivery failures.

`messageSplitting` is a deprecated compatibility option. Remove it; `false`
is rejected because automatic delivery is the v2 contract. Only PO catalog
imports are supported by this adapter. Keep server adapter imports behind
`server-only`; they require Node and are not Edge runtime entry points.

The Next render-lifetime adapter supports the package's declared Next 16 peer
range and is verified against Next 16.3.4. It intentionally binds to Next's
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
import { createNextServerI18n } from "@palamedes/next-plugin/server";
import { getLocale } from "./lib/i18n.server";

export async function initializeServerFunctionI18n(): Promise<void> {
  const { locale } = await getLocale();
  await createNextServerI18n({ locale });
}
```

The plugin automatically discovers this entry. `serverFunctions: true` can
require its presence explicitly; the default needs no feature flag.

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

The initializer owns locale policy and calls `createNextServerI18n()` before
any translated action code runs. It should be request-memoized or otherwise
idempotent. Complete active-locale server catalogs also cover helpers reached
through dynamic imports during the action; no application fragment registration
or message-loading step is needed. Catalog content is reused across requests,
while each request keeps its own i18n instance.

Parameter defaults execute before the function body. Palamedes therefore
rejects eager macros in Server Function parameter initializers, including
nested destructuring defaults. Move such defaults into the body and preserve
JavaScript default-parameter semantics explicitly:

```ts
export async function save(message?: string) {
  "use server";
  if (message === undefined) message = t`Fallback`;
}
```

Do not replace this guard with `??=` unless `null` should also select the
fallback. Server Function instrumentation targets the Next.js integration.

## Options

```js
const { withPalamedes } = require("@palamedes/next-plugin");

module.exports = withPalamedes(
  {},
  {
    include: /\.([cm]?[jt]s|[jt]sx)$/,
    exclude: /node_modules/,
    enablePoLoader: true,
    configPath: "./palamedes.yaml",
    projectRoot: undefined,
    failOnMissing: false,
    keepSourceFallbacks: undefined,
    workspaceRoot: undefined,
    serverFunctions: true,
  },
);
```

`keepSourceFallbacks` retains its legacy option name and defaults to `false`.
Set it to `true` only to include diagnostic source metadata in generated calls.
V2 package roots and `compiled` aliases both throw on missing compiled entries;
retained metadata never supplies replacement message output. Valid translation
fallbacks are resolved and compiled at build time.
`failOnCompileError` is deprecated: invalid or unsupported ICU always fails
compilation, including when this legacy option is `false`.

`include` and `exclude` select which sources are macro-transformed, and apply
under both bundlers: webpack uses them as the loader's `test`/`exclude`, and
Turbopack receives them as `{ path: include }` plus `{ not: { path: exclude } }`
in the rule condition.

The two bundlers do not match the same string, so a regex that is anchored to a
directory layout can behave differently:

- webpack tests the **absolute resource path** (`/home/me/app/src/page.tsx`)
- Turbopack tests **its own internal path representation** for the module,
  which is not guaranteed to be that absolute OS path

Patterns matching a file extension (`/\.([cm]?[jt]s|[jt]sx)$/`) or a path segment
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

`projectRoot` pins the Next application directory. Under the normal Next CLI,
Palamedes derives it from `next dev apps/web` / `next build apps/web`; webpack
and Turbopack loaders also prefer their supplied Next root context. This makes
config discovery, `palamedes.server.*`, catalog paths, and cache entries belong
to the app rather than the shell's working directory. Relative `configPath`
values resolve from this directory. Set `projectRoot` explicitly in a custom
Next host or if the app directory is ambiguous. `cwd` is a deprecated alias.

`workspaceRoot` pins the monorepo root used for Turbopack and output file
tracing. When omitted, `withPalamedes` walks upward from the Next project root
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

<!-- ferramenta-family:start -->

**palamedes** is part of the [Ferramenta](https://ferramenta.dev) family — Rust-native developer tools that keep the APIs the ecosystem already knows.

Siblings: [ferroni](https://sebastian-software.github.io/ferroni/) · [ferriki](https://github.com/sebastian-software/ferriki) · [ferromark](https://sebastian-software.github.io/ferromark/) · [ferrolex](https://github.com/sebastian-software/ferrolex) · [ferrocat](https://ferrocat.dev) · [ferrovia](https://github.com/sebastian-software/ferrovia) · [ferralk](https://github.com/sebastian-software/ferralk) · [ferrugo](https://github.com/sebastian-software/ferrugo).
<!-- ferramenta-family:end -->

## License

[![Sebastian Software](https://sebastian-brand.vercel.app/sebastian-software/logo-software.svg)](https://oss.sebastian-software.com/)

MIT OR Apache-2.0 © 2026 Sebastian Software
