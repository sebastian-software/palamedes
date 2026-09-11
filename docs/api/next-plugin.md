# `@palamedes/next-plugin`

`@palamedes/next-plugin` wires Palamedes macro transformation and automatic
compiled catalog delivery into Next.js.

For an executable App Router Server Component path, start with
[First Working Translation with Next.js](../nextjs-first-run.md).

Catalog storage can be PO or FCL in `palamedes.yaml`, but the automatic Next
graph/server-splitting path currently supports PO catalogs only. A configured
FCL catalog is rejected by that path. See [Catalog formats](../catalog-formats.md)
for the storage/import boundary.

## Exports

- `withPalamedes(baseConfig?, options?)`
- default export `withPalamedes`
- `WithPalamedesOptions`
- `createNextServerI18n({ locale, timeZone?, ...options })` from `@palamedes/next-plugin/server`
- `createNextServerI18nScope<T>()` from `@palamedes/next-plugin/server`
- `@palamedes/next-plugin/server-function-initializer`
- `@palamedes/next-plugin/server-function-entry`
- internal loader subpaths used by plugin wiring:
  `@palamedes/next-plugin/palamedes-loader` and
  `@palamedes/next-plugin/palamedes-po-loader`

## Options

```ts
interface WithPalamedesOptions {
  include?: RegExp;
  exclude?: RegExp;
  enablePoLoader?: boolean;
  configPath?: string;
  projectRoot?: string;
  /** @deprecated Use projectRoot. */
  cwd?: string;
  failOnMissing?: boolean;
  /** @deprecated Invalid and unsupported ICU is always fatal in v2. */
  failOnCompileError?: boolean;
  runtimeModule?: string;
  keepSourceFallbacks?: boolean;
  workspaceRoot?: string;
  serverFunctions?: boolean;
  messageSplitting?: boolean;
}
```

Defaults:

- `include`: `/\.([cm]?[jt]s|[jt]sx)$/`
- `exclude`: `/node_modules/`
- `enablePoLoader`: `true`
- `failOnMissing`: `false`
- `failOnCompileError`: deprecated compatibility option; it no longer
  downgrades invalid or unsupported ICU to a warning.
- `runtimeModule`: `"@palamedes/runtime"`
- `keepSourceFallbacks`: `false`
- `serverFunctions`: automatic discovery of `palamedes.server.*`
- `messageSplitting`: deprecated; automatic delivery is always enabled, `false` throws

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

`keepSourceFallbacks` retains its legacy option name and defaults to `false`.
Set it to `true` only for diagnostic source metadata in generated calls.
V2 package roots and `compiled` aliases both throw on missing compiled entries;
retained metadata never supplies replacement message output. Valid translation
fallbacks are resolved and compiled at build time.

## Usage

```js
const { withPalamedes } = require("@palamedes/next-plugin");

module.exports = withPalamedes({});
```

## Server Functions

Next Server Functions and Actions execute as requests separate from the page
render. First expose the application-owned initializer through the conventional
server entry module:

```ts
// src/palamedes.server.ts
import { createActiveServerI18n } from "./lib/i18n.server";

export async function initializeServerFunctionI18n(): Promise<void> {
  await createActiveServerI18n();
}
```

The plugin discovers this entry automatically. `serverFunctions: true` explicitly
requires it to exist; no flag is needed for the standard setup.

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

## App Router catalog delivery

```ts
import "server-only";
import { createNextServerI18n } from "@palamedes/next-plugin/server";

const i18n = await createNextServerI18n({ locale: "de", timeZone: "Europe/Berlin" });
```

Call this during request initialization after resolving the locale. It lazily
loads the configured full active-locale catalog through an adapter-generated
module and activates a fresh i18n instance under Next's weak render key. The
scope survives suspension and Client Component server rendering. Catalog
content is immutable and shared per process/module generation; request options
and callbacks remain isolated. No eager import of unused locales or complete
catalog copy occurs per request. Development catalog/config edits invalidate
the generated module while existing requests retain their immutable view.

`createNextServerI18nScope<T>()` remains available for explicit request-scoped
callbacks. Both APIs require Node and must stay out of Client Components and
Edge code. The adapter supports the declared Next 16 peer range and is verified
against Next 16.3.4; removal of Next's internal render storage fails the build.

Browser modules automatically await the native compiled fragments selected by
their macro usage and `document.documentElement.lang`. Only then can dependent
code evaluate. Initial hydration and later navigation therefore request the
active locale and evaluated module graph. No application catalog boundary,
locale-loader map, import-map HTML, or executable RSC payload is required.

Set `<html lang>` from the server locale policy. Optional
`data-palamedes-time-zone` preserves the selected client formatting time zone.
Locale changes require a full document navigation. Raw ICU catalogs are never
accepted by application runtimes. PO is currently required for automatic Next
graph delivery; the legacy `messageSplitting: false` option throws instead of
selecting an older mode.

Required fragment failures stop dependent module execution in both development
and production. Missing compiled entries also throw. Provide ordinary Next
`error.tsx` and `global-error.tsx` views without translated dependencies, with
generic copy and a full document reload action. A boundary reset cannot reliably
recover an ESM import whose failure has been cached. Build-time compiled
translation fallback remains available and does not recover delivery failures.

The generated bootstrap adds no inline scripts, string-to-code evaluation, or
serialized executable functions. Configure CSP for Next's own scripts and the
served catalog assets. Selected PO and fallback/config files remain normal
build dependencies. Next can use Fast Refresh or reload at async-module
boundaries; a document reload is the supported recovery when HMR cannot apply.

Eager translation calls belong inside functions after initialization. Module
scope and Server Function parameter-initializer macros remain compile errors.

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
