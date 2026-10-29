# `@palamedes/next-plugin`

`@palamedes/next-plugin` wires Palamedes macro transformation and automatic
compiled catalog delivery into Next.js.

For an executable App Router Server Component path, start with
[First Working Translation with Next.js](../nextjs-first-run.md).

Catalog storage can be PO or FCL in `palamedes.yaml`, but automatic Next.js
catalog delivery currently supports PO catalogs only. A configured
FCL catalog is rejected by that path. See [Catalog formats](../catalog-formats.md)
for the storage/import boundary.

## Exports

- `withPalamedes(baseConfig?, options?)`
- default export `withPalamedes`
- `WithPalamedesOptions`
- `createNextServerI18n({ locale, timeZone?, ...options })` from `@palamedes/next-plugin/server`
- `createNextServerI18nScope<T>()` from `@palamedes/next-plugin/server`

`withPalamedes()` also wires these **Internal** subpaths into the Next.js
build by path: `server-function-initializer`, `server-function-entry`,
`server-catalogs`, `palamedes-loader`, `palamedes-po-loader`,
`palamedes-server-catalogs-loader`, and `catalog-fragment`. Applications do
not import them, and they are not covered by SemVer. See the
[stability table](../stability.md#subpath-tiers).

## Options

```ts
interface WithPalamedesOptions {
  include?: string | RegExp | Array<string | RegExp> | null;
  exclude?: string | RegExp | Array<string | RegExp> | null;
  enablePoLoader?: boolean;
  configPath?: string;
  projectRoot?: string;
  failOnMissing?: boolean;
  runtimeModule?: string;
  includeSourceMetadata?: boolean;
  workspaceRoot?: string;
  serverFunctions?: boolean;
}
```

Defaults:

- `include`: `/\.([cm]?[jt]s|[jt]sx)$/`
- `exclude`: `/node_modules/`
- `enablePoLoader`: `true`
- `failOnMissing`: `false`
- `runtimeModule`: `"@palamedes/runtime"`
- `includeSourceMetadata`: `false`
- `serverFunctions`: automatic discovery of `palamedes.server.*`

`withPalamedes()` throws a migration error when it receives a removed v1
option: `failOnCompileError`, `keepSourceFallbacks` (renamed to
`includeSourceMetadata`), `messageSplitting` with any value, or `cwd` (use
`projectRoot`). See the
[v2 migration guide](../migration-v2.md#replace-removed-apis).

`projectRoot` is the Next application directory used for Palamedes config
discovery, `palamedes.server.*` resolution, loader cache keys, and workspace
root detection. With `next dev apps/web` or `next build apps/web`, it is derived
from the Next CLI directory; webpack and Turbopack loaders use their Next root
context when available. Relative `configPath` values and relative
`include`/`exclude` globs resolve from this root. For custom hosts or ambiguous
invocation, set `projectRoot` explicitly.

`include` and `exclude` accept a glob string, a RegExp, or an array of both,
with the same matching as the [Vite plugin](./vite-plugin.md#paths-and-filters).
RegExps test the absolute file path under both webpack and Turbopack. Turbopack
rule conditions only see paths relative to its own root, so user patterns never
narrow the Turbopack rule; the transform loader applies the filter and passes
unmatched modules through unchanged.

Catalog `include` and `exclude` globs match dot-prefixed path segments. Since
1.17.1 this behavior is shared with the Vite integration, so a matching source
file below a dot-directory is transformed and participates in
`failOnMissing` validation.

`includeSourceMetadata` defaults to `false`. Set it to `true` only for
diagnostic source metadata in generated calls.
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

Locale negotiation reads request state. Keep locale cookie writes and expiry
renewal out of the initializer and ordinary Server Action POST handling in
middleware/proxy. Writing the same cookie value still counts as a mutation in
Next.js and can add a page render to the action response and invalidate
prefetched routes. Persist explicit locale choices separately, skipping a write
when the cookie already matches. A read-only action can resolve a missing or
unsupported cookie through fallback without persisting it.

Application data mutations own their revalidation or `router.refresh()` calls.
Locale switches persist the choice and then navigate to a new document; a
global layout revalidation is not needed solely for that document navigation.
Cookie mutation can still cause Next to render the current page with the action
result. See [Next.js cookie behavior](https://nextjs.org/docs/app/api-reference/functions/cookies).

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
Edge code. The adapter declares `next@^16.4.1` and is verified against Next
16.4.1. It keys requests to Next's internal render storage; when the installed
Next no longer provides that module, `withPalamedes()` fails the build. See the
[Next.js contract](../stability.md#next-js-contract).

Browser modules automatically await the native compiled fragments selected by
their macro usage and `document.documentElement.lang`. Only then can dependent
code evaluate. Initial hydration and later navigation therefore request the
active locale and evaluated module graph. No application catalog boundary,
locale-loader map, import-map HTML, or executable RSC payload is required.

Set `<html lang>` from the server locale policy. Optional
`data-palamedes-time-zone` preserves the selected client formatting time zone.
Locale changes require a full document navigation. Raw ICU catalogs are never
accepted by application runtimes. PO is currently required for automatic Next.js
catalog delivery; the removed `messageSplitting` option throws instead of
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
16.4.1 or a later 16.x release (`peerDependencies: next ^16.4.1`). The
emitted top-level `turbopack.rules` conditions and `outputFileTracingRoot`
need the Next 16 config surface.

`include` and `exclude` apply under both bundlers against the absolute file
path: webpack tests them in the loader rule, and the Turbopack transform loader
applies the same filter. Turbopack tests a rule's `path` condition against the
module path relative to its root (`src/page.tsx`), so Palamedes does not put
user patterns into the rule condition. A pattern like `/\/src\//` therefore
selects the same files under both bundlers, in a standalone app as in a
monorepo. Only the default extension pattern also narrows the Turbopack rule,
because a file extension is the same suffix in both path forms.

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
