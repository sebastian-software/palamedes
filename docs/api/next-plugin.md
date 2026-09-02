# `@palamedes/next-plugin`

`@palamedes/next-plugin` wires Palamedes macro transformation and `.po` loading
into Next.js.

For an executable App Router Server Component path, start with
[First Working Translation with Next.js](../nextjs-first-run.md).

Catalog storage can be PO or FCL in `palamedes.yaml`, but this API is still a
`.po` import loader. See [Catalog formats](../catalog-formats.md) for the
storage/import boundary.

## Exports

- `withPalamedes(baseConfig?, options?)`
- default export `withPalamedes`
- `WithPalamedesOptions`
- `createNextServerI18nScope<T>()` from `@palamedes/next-plugin/server`
- `@palamedes/next-plugin/server-function-initializer`
- `@palamedes/next-plugin/server-function-entry`
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
  projectRoot?: string
  /** @deprecated Use projectRoot. */
  cwd?: string
  failOnMissing?: boolean
  failOnCompileError?: boolean
  runtimeModule?: string
  keepSourceFallbacks?: boolean
  workspaceRoot?: string
  serverFunctions?: boolean
  messageSplitting?: boolean
}
```

Defaults:

- `include`: `/\.([cm]?[jt]s|[jt]sx)$/`
- `exclude`: `/node_modules/`
- `enablePoLoader`: `true`
- `failOnMissing`: `false`
- `failOnCompileError`: `false`
- `runtimeModule`: `"@palamedes/runtime"`
- `keepSourceFallbacks`: `true`
- `serverFunctions`: `false`
- `messageSplitting`: `false`

`projectRoot` is the Next application directory used for Palamedes config
discovery, `palamedes.server.*` resolution, loader cache keys, and workspace
root detection. With `next dev apps/web` or `next build apps/web`, it is derived
from the Next CLI directory; webpack and Turbopack loaders use their Next root
context when available. Relative `configPath` values resolve from this root.
For custom hosts or ambiguous invocation, set `projectRoot` explicitly. `cwd`
is a deprecated alias.

Catalog `include` and `exclude` globs match dot-prefixed path segments. Since
1.17.1 this behavior is shared with the Vite integration, so a matching source
file below a dot-directory is transformed and participates in
`failOnMissing` validation.

Production output keeps authored source fallbacks by default so deploy skew or
a missing split catalog remains readable. Set `keepSourceFallbacks: false` only
when bundle size or source-text exposure outweighs that resilience; then a
missing entry renders its compiled id. The parser-free runtime intentionally
does not parse retained ICU source patterns, so use `@palamedes/core` if a
fallback must interpolate and use `onMissing` to measure misses.

## Usage

```js
const { withPalamedes } = require("@palamedes/next-plugin")

module.exports = withPalamedes({})
```

## Server Functions

Next Server Functions and Actions execute as requests separate from the page
render. First expose the application-owned initializer through the conventional
server entry module:

```ts
// src/palamedes.server.ts
import { createActiveServerI18n } from "./lib/i18n.server"

export async function initializeServerFunctionI18n(): Promise<void> {
  await createActiveServerI18n()
}
```

Then enable instrumentation once in the Next configuration:

```js
module.exports = withPalamedes(
  {},
  {
    serverFunctions: true,
  }
)
```

The entry can be named `palamedes.server.ts`, `.tsx`, `.js`, `.jsx`, `.mts`,
`.mjs`, `.cts`, or `.cjs` and live in either the project root or `src`.
Exactly one entry must exist, and it must export
`initializeServerFunctionI18n`. The initializer should resolve the locale,
load and activate a fresh request-local i18n instance, and be request-memoized
or idempotent. Palamedes keeps the module address internal and awaits the
initializer at the start of every recognized async Server Function, whether or
not that function contains a macro itself. Recognition covers inline
`"use server"` directives and async exports from top-level `"use server"`
modules.

Eager macros in formal parameter initializers are rejected because parameter
defaults execute before injected body statements. Move the fallback into the
function body with `if (value === undefined)` when matching JavaScript's
default-parameter behavior; `??=` also treats `null` as absent and is not an
equivalent rewrite.

## App Router Client Message Splitting

Create the request scope once in a server-only module. Unlike the generic Node
scope, this adapter keys the instance to Next's complete render lifetime, so it
survives suspension and the handoff from the RSC pass to Client Component
server rendering:

```ts
import "server-only"

import { createNextServerI18nScope } from "@palamedes/next-plugin/server"
import type { PalamedesI18n } from "@palamedes/core"

export const serverI18n = createNextServerI18nScope<PalamedesI18n>()
```

Activate a fresh instance during each request's initialization. The adapter
stores it under a weak Next render key, never as a process-global last request.
Its server-storage integration supports the declared Next 16 peer range and is
verified against Next 16.2. If a later Next 16 build removes that internal
module, the application build fails with a module-resolution error; upgrade
Palamedes before adopting that Next release.

For PO catalogs, enable graph-split client delivery next to the server setup:

```js
module.exports = withPalamedes(
  {},
  {
    messageSplitting: true,
    serverFunctions: true,
  }
)
```

```tsx
// app/page.tsx (Server Component)
const { locale } = await createActiveServerI18n()

return <TranslatedClientContent locale={locale} />
```

No application-owned client catalog boundary is required. For every
message-bearing Client Component or transitive browser helper, the loader emits
one selected PO import per configured locale. Module evaluation awaits only the
import selected by `document.documentElement.lang`, initializes one shared
parser-free client instance, and loads that source module's fragment before its
exports can render. In production, a rejected fragment is logged and skipped
so the module can still evaluate; that module's translations are unavailable
unless a fallback is retained. Initial hydration and later client navigation
therefore follow `active locale × evaluated client module graph`; other locales
and unvisited route messages remain in separate chunks.

The bootstrap is generated for browser modules only. Server Components keep
using the request-local scope above, and no executable message function crosses
the RSC serialization boundary. Changing locale still requires a document
navigation. Both Turbopack and webpack are covered by production browser tests;
the webpack client compilation enables async modules because the bootstrap uses
top-level await.

No inline script, `eval`, JSON serialization, or application-owned i18n proxy
is involved. This keeps the bootstrap compatible with strict CSP and the
parser-free generated catalog representation.

As with Palamedes' other eager translation APIs, translation calls must execute
inside a function, method, or callback after i18n activation. The macro
transform rejects eager `t`, `plural`, `select`, and `selectOrdinal` calls at
module scope, and declarations that defer translation until component render
remain valid. The generated client bootstrap initializes the module's own
fragment before its body evaluates, so custom compiled-adapter calls observe
that fragment if they must run eagerly.

In development, each selected `.po` import remains a real dependency of its
consuming browser module. Catalog edits therefore invalidate the affected
subset under both Turbopack and webpack. Next may apply Fast Refresh or fall
back to a full document reload at an async-module boundary; reloading the
document is the supported fallback and reuses its `<html lang>` locale.

`messageSplitting` currently supports PO catalogs. Keep it disabled for other
catalog formats or for a custom client-loading strategy. The compatibility
fallback is `createClientCatalogBoundary()` from `@palamedes/react/client`,
which loads one complete active-locale catalog. Graph-split apps should author
client messages through Palamedes macros or compiled adapters; raw ICU strings
passed to compatibility runtime components require the full parser and are not
part of the parser-free bootstrap contract.

Palamedes intentionally provides no in-document locale-switching mode. See
[Locale strategies](../locale-strategies.md#unsupported-root-key-escape-hatch)
for the unsupported root-key escape hatch and its limitations.

Production output retains authored messages by default, so a missing catalog
fragment stays readable during a staggered deploy. It still omits translator
comments and context metadata from runtime descriptors. Set
`keepSourceFallbacks: false` to opt into smaller, hash-only output when source
text cannot ship. The option is forwarded identically to the Turbopack and
webpack transform loaders.

Production does not immediately retry a rejected fragment import. This is a
deliberate trade-off: likely deterministic CDN, ad-blocker, or stale-deploy
failures need backoff or a later navigation rather than another request in the
same bootstrap turn. Development remains fail-fast to surface catalog wiring
errors while editing.

The plugin configures both Turbopack and webpack paths, and requires Next.js
16 (`peerDependencies: next ^16` — the emitted top-level `turbopack.rules`
conditions and `outputFileTracingRoot` need the Next 16 config surface).
`include` and `exclude` apply under both bundlers: in the webpack branch as
loader `test`/`exclude`, under Turbopack translated into the rule condition
(`{ path: include }` plus `{ not: { path: exclude } }`).

The regex is not matched against the same string in both cases. Webpack tests
the absolute resource path (`/home/me/app/src/page.tsx`); Turbopack tests its
own internal path representation for the module, which is not guaranteed to be
that absolute OS path. Extension patterns (`/\.([cm]?[jt]s|[jt]sx)$/`) and path-segment
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
detection from the Next project root is not correct.
