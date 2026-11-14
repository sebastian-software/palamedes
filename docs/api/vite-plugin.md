# `@palamedes/vite-plugin`

`@palamedes/vite-plugin` transforms Palamedes macro imports, compiles `.mdx`
modules, and compiles `.po` imports inside Vite builds.

Catalog storage can be PO or FCL in `palamedes.yaml`. The standard framework
flow derives compiled active-locale dependencies from the evaluated module
graph and does not require application-owned catalog imports or locale maps.
The low-level `.po` import hook remains available for explicit custom
integrations; it is not the standard delivery path. See [Catalog
formats](../catalog-formats.md) for the storage/import boundary.

## Exports

- `palamedes(options?)`
- default export `palamedes`
- `PalamedesPluginOptions`
- `PalamedesFramework`: `"react" | "solid" | "none"`, the type of the
  `framework` option

## Options

```ts
interface PalamedesPluginOptions {
  include?: string | RegExp | Array<string | RegExp> | null;
  exclude?: string | RegExp | Array<string | RegExp> | null;
  enablePoLoader?: boolean;
  configPath?: string;
  projectRoot?: string;
  skipValidation?: boolean;
  failOnMissing?: boolean;
  framework?: PalamedesFramework; // "react" | "solid" | "none"
  runtimeModule?: string;
  includeSourceMetadata?: boolean;
  mdx?: PalamedesMdxConfig | false;
  environment?: "auto" | "server";
  experimentalReactCatalogHmr?: boolean;
}
```

Defaults:

- `include`: JavaScript/TypeScript (`/\.([cm]?[jt]s|[jt]sx)$/`) and Vue/Svelte components (`/\.(vue|svelte)$/i`)
- `exclude`: `/node_modules/`
- `projectRoot`: Vite's resolved `root`; the current working directory in
  bundlers without Vite's `configResolved` hook
- `configPath`: unset — Palamedes searches upward from `projectRoot`
- `enablePoLoader`: `true`
- `failOnMissing`: `false`
- `framework`: `"react"`
- `runtimeModule`: `"@palamedes/runtime"`
- `includeSourceMetadata`: `false`
- `mdx`: values from Palamedes config with React defaults; `false` disables MDX
- `environment`: `"auto"`
- `experimentalReactCatalogHmr`: `false`

The plugin throws a migration error during setup when it receives a removed v1
option: `failOnCompileError`, `keepSourceFallbacks` (renamed to
`includeSourceMetadata`), `cwd` (renamed to `projectRoot`), or
`experimentalGraphSplitting` with any value, including `{ localeBinding }`. See
the [v2 migration guide](../migration-v2.md#replace-removed-apis).

### Paths and filters

The Vite, Next.js, and Remix adapters share one path contract:

- `projectRoot` is the base for config discovery, a relative `configPath`, and
  relative `include`/`exclude` globs. A relative `projectRoot` resolves from
  the current working directory.
- `configPath` resolves from `projectRoot`. Absolute paths stay absolute.
- `include` and `exclude` accept a glob string, a RegExp, or an array of both.
  Relative globs resolve from `projectRoot`; globs that start with `**` and
  absolute globs match as written. RegExps test the absolute file path with
  forward slashes. An `exclude` match wins, and an empty `include` accepts
  every file that is not excluded.

The matching follows Vite's `createFilter()`, with `projectRoot` as the glob
base. Every value Vite's `FilterPattern` type accepts still works.

`framework` states which UI framework the app compiles for and selects the
component contract for generated MDX modules. Solid apps must set
`framework: "solid"`.

Macro and generated MDX runtime lookups always use the plain, hook-free getter.
Locale changes require document navigation. `runtimeModule` is an advanced
override for only the macro transform's module path.

`environment: "auto"` reads the Vite environment to tell server builds from
browser builds. Bundlers without Vite environments, such as tsdown or
standalone Rolldown building a Node backend, need `environment: "server"`.

`includeSourceMetadata` defaults to `false` in every environment. Set
`includeSourceMetadata: true` to retain authored text for diagnostics in macro
and MDX output. Missing compiled messages throw; source metadata never supplies
replacement output.
Valid translation fallbacks are compiled by the native compiler.

Generated MDX modules can set `mdx.runtime-module` in `palamedes.yaml` or
`mdx.runtimeModule` on the plugin when integrating a custom runtime.

Compiled delivery follows the evaluated module graph automatically. Development
awaits the active locale's generated fragment before running its source module.
When an edit changes the set of messages a module uses, development refreshes
that module's fragments through HMR, even when no catalog file changed.
Production emits locale-bound import maps and separate executable fragments.
Modules that Rollup places in one output chunk share one message asset per
locale, so message requests follow chunks rather than source modules.
Set the document's `lang` before its module entry runs; the adapter initializes
the client instance. Locale changes require document navigation.

### Experimental React catalog HMR

Plain Vite React apps with Fast Refresh boundaries can opt into:

```ts
palamedes({ experimentalReactCatalogHmr: true });
```

This mode keeps the active document locale fixed and updates PO/FCL translations
without remounting the React root. Both `Trans` and ordinary macro calls refresh
through the host's existing React boundaries. Application state is preserved
when those boundaries support Fast Refresh; a host that requires a reload keeps
its ordinary fallback. The verified browser proof uses a plain Vite React app.
Other SSR/RSC hosts have no in-place-update guarantee from this option.

Development loads one complete compiled catalog snapshot for the document's
active locale. All configured catalog/locale snapshots are validated before an
edit is delivered, including the `failOnMissing` gate when enabled. Catalogs
retain their source include/exclude and selected-message validation. An unused
catalog cannot supply a missing identity for another source. This experimental
complete-snapshot mode rejects conflicting values for the same ID across
catalogs; use distinct source/context identities or disable the option for
ordinary scoped fragment delivery. Eager and later lazy modules use the same
generation. A delayed older response cannot overwrite a
newer committed snapshot. Invalid edits show Vite's development error overlay
and keep the last valid UI; correcting the catalog resumes updates.
Vite retains its first-update error recovery policy: a correction before the
first normal HMR update can reload the document. Later valid translation edits
preserve Fast Refresh state.

Configuration changes restart the Vite development server and reload the
document, discarding its cached host module graph. Source message membership
changes and removed compiled message identities also reload the document.
Ordinary React source edits keep
their existing Fast Refresh behavior. Production keeps its normal split
fragments. Locale switches still navigate to a new document. The mode requires
`framework: "react"`; Solid and other integrations keep reload-based catalog
updates. Solid's current refresh boundary can recreate component-local signals,
so disabling document reload alone would not preserve its application state.

After building packages, run the PO/FCL browser proof with:

```sh
node scripts/proof-react-catalog-hmr.mjs
```

It also runs from the existing Vite development proof in the example browser
lane. It requires the example's dependencies, the matching native addon, and the
Chromium revision installed by `pnpm exec playwright install chromium`.

Vite's resolved `base` must be root-relative, such as `/app/`, or an absolute
URL. Relative bases are rejected because nested document URLs would resolve
import-map catalog URLs differently. No embedded-locale alternative exists.

With `failOnMissing: true`, compiled MDX IDs are checked against every target
locale in each catalog whose `include` patterns cover that MDX file. This
reports missing MDX translations even when the catalog module has not been
imported yet.

## Usage

```ts
import { defineConfig } from "vite";
import { palamedes } from "@palamedes/vite-plugin";

export default defineConfig({
  plugins: [palamedes()],
});
```

Keep `palamedes()` before the React or Solid Vite plugin so the native MDX
compiler emits JSX before the framework transform runs. React MDX parsing is
configured automatically. Solid must use `solid({ extensions: [".mdx"] })`.
See [MDX messages](../mdx.md) for authoring and configuration.

## Vue single-file components

Use `plugins: [palamedes({ framework: "none", mdx: false }), vue()]`, where `vue`
comes from `@vitejs/plugin-vue`. Keep Palamedes before the Vue plugin. Macros
from `@palamedes/core/macro` work directly in inline `<script setup>` and
`<script>` blocks, including TypeScript. The native CLI and
`@palamedes/extractor` discover the same messages with `.vue` origins.
Import macros in the script block that uses them.

```vue
<script setup lang="ts">
import { computed, ref } from "vue";
import { plural, t } from "@palamedes/core/macro";

const title = t`Choose your tickets`;
const quantity = ref(1);
const label = computed(() => {
  const count = quantity.value;
  return plural(count, { one: "# ticket", other: "# tickets" });
});
</script>

<template>
  <h1>{{ title }}</h1>
  <p>{{ label }}</p>
</template>
```

Compiled active-locale messages are delivered before the component executes,
including for async Vue components. Catalog imports and runtime initialization
remain adapter-owned. Imported macros used in HTML template expressions fail
with a located diagnostic; move the macro call into `<script setup>` and render
the resulting value. Template expressions, automatic template-text extraction,
and Vue rich-text components are not supported. See the runnable
[Vue proof](../../proof/vue-vite/README.md).

## Svelte components (Preview)

Use `plugins: [palamedes({ framework: "none", mdx: false }), svelte()]`, where
`svelte` comes from `@sveltejs/vite-plugin-svelte`. Palamedes must run first.
Core macros work in inline JavaScript or TypeScript instance and module scripts.
Instance-level calls are valid because Svelte runs that code per component;
module-level calls must be inside functions. Import macros in the same script
block as their calls. Markup is not a macro surface: a macro call in a markup
expression, such as ``{t`Hello`}`` or `{plural(count, …)}`, fails extraction and
the transform with a located error. Create the message in a script and render
the value. Native CLI extraction and transforms retain original `.svelte`
references, markup, styles, and source maps.

```svelte
<script lang="ts">
import { plural, t } from "@palamedes/core/macro";

const title = t`Choose your tickets`;
let quantity = $state(1);
const label = $derived(plural(quantity, { one: "# ticket", other: "# tickets" }));
</script>

<h1>{title}</h1>
<button onclick={() => quantity++}>{label}</button>
```

The existing Vite adapter delivers only the active locale's component fragments
before initial and dynamically imported components execute. Applications do not import catalogs or initialize the runtime manually. Locale controls navigate to
a new document, following [ADR-007](../../adr/007-locale-is-fixed-for-a-browser-document.md).

The private [Svelte + Vite proof](../../proof/svelte-vite/README.md) uses the shared
four-language booking demo. This Preview is browser-only. Template-expression
macros, automatic template-text extraction, Svelte rich text, catalog HMR,
and preprocessors beyond JavaScript/TypeScript are outside its verified scope.

The separate [SvelteKit SSR proof](../../proof/sveltekit-ssr/README.md) reuses
this compiler with SvelteKit 3.1 and its Node adapter. A local Vite integration
and server hook own request-local runtimes, server catalog reuse, document
locale metadata, and browser catalog delivery before hydration. The proof uses
`paths: { relative: false }` because locale import maps require absolute asset
URLs. Application components use macros directly, including on the server;
they contain no catalog loaders. This Preview covers root-mounted, same-origin
query-locale deployment and remains separate from the supported server matrix.

## Server and document delivery

Server code creates request state with
`createBundledServerI18n({ locale, timeZone?, ...options })` from
`@palamedes/runtime/server/bundled`; the plugin supplies the catalog store
behind that import, so application code does not depend on the build plugin at
runtime. In server builds the plugin also resolves `@palamedes/runtime/node`
to that bundled store, so Node backends can share one i18n module with their
unbundled runtime-macro path. It awaits the shared,
immutable complete catalog for the active locale and returns fresh request
state. Host request middleware keeps that state in its request scope across
SSR, loaders and actions. Applications do not construct catalog import maps.

The adapter keeps its server entrypoints and runtime packages in Vite's SSR
module graph automatically, including when installed from npm rather than
linked from a workspace. This applies to every server
environment, such as the `rsc` environment used by Waku, not only to `ssr`. It also keeps `@palamedes/waku` in that graph so the adapter
shares Waku's request store. Existing `noExternal` entries and `true` are
preserved. `@palamedes/react-router` stays in the graph as well, because it
loads the generated server catalogs through the runtime. Applications do not
need a Palamedes-specific `ssr.noExternal` or
`resolve.noExternal` configuration.

`@palamedes/vite-plugin/delivery` exports `createViteCatalogDelivery({
clientDirectory, development?, manifestName? })`. Server code calls
`getLocaleBinding(locale)` on it and pipes HTML through
`createDocumentTransform(binding, { nonce?, errorHtml?, lang?, htmlAttributes? })`. The Solid,
TanStack, Waku, and React Router adapters do this internally; see the
[React Router Framework Mode guide](./react-router.md). `errorHtml` is trusted,
catalog-independent host markup; the default view provides Reload and Home.
`lang` writes the document locale to `<html lang>`, for hosts whose layout
cannot know the request locale for every document. `htmlAttributes` sets
further `<html>` attributes, such as a marker the host's browser code reads.
Import maps precede all modulepreloads. Catalog-only manifest changes refresh
without restarting the host. Missing production assets fail closed.

React Router's initial route imports run before its client entry. The document
transport observes their catalog dependencies independently. Lazy route facades
forward failures into the host's normal ErrorBoundary instead of React Router's
automatic reload. Error UI must be independent of message catalogs.

In development, recovery listens to explicit catalog-delivery failures;
unrelated application errors remain with the host's error handling.

Static HTML applications receive a generated module entry that installs the
active locale's import map and awaits application dependencies. An optional
`<template data-palamedes-error>` supplies the host's error view. Existing module
script nonces propagate to the generated entry and import map.

### Static documents generated after the Vite build

Some frameworks generate HTML after Vite's `generateBundle` hook. React Router
Framework Mode with `ssr: false`, for example, can prerender locale pages and
emit an unprefixed SPA fallback. Run `createStaticViteCatalogBootstrap` from
`@palamedes/vite-plugin/delivery` **after** prerender, on each document. It
reads generated maps, replaces approved module startup scripts with inert
placeholders, and returns rewritten HTML and a content-addressed bootstrap.
Write both to the client directory. The bootstrap installs the selected map,
checks initial catalog dependencies, and restores each module at its original
position. Lazy dependencies remain bound to that document's locale.

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createStaticViteCatalogBootstrap } from "@palamedes/vite-plugin/delivery";

const clientDirectory = path.resolve("build/client");
const delivery = createStaticViteCatalogBootstrap({ clientDirectory });
// Separately reviewed SHA-256 digests of complete original <script> elements,
// in document order, for each output document.
const approved = JSON.parse(await readFile("approved-scripts.json", "utf8"));
for (const file of ["en/index.html", "de/index.html", "index.html"]) {
  const htmlPath = path.join(clientDirectory, file);
  const result = delivery.transformDocument({
    html: await readFile(htmlPath, "utf8"),
    allowedScripts: approved[file],
    scriptLimits: { maxCount: 20, maxElementBytes: 32768, maxTotalBytes: 131072 },
    locale:
      file === "index.html"
        ? { kind: "fallback", policyModule: "/policy.js" }
        : { kind: "document" },
  });
  await mkdir(path.dirname(path.join(clientDirectory, result.bootstrap.fileName)), {
    recursive: true,
  });
  await writeFile(path.join(clientDirectory, result.bootstrap.fileName), result.bootstrap.source);
  await writeFile(htmlPath, result.html);
  // Add result.cspHashes to script-src, retain the host's approved classic
  // script hashes, and authorize its local bootstrap and policy assets.
}
```

For a prerendered public page, `kind: "document"` treats its `<html lang>` as
authoritative, regardless of browser preferences or query parameters. For the
SPA fallback, the local, catalog-independent policy module exports a pure
`resolveLocale({ pathname, search, languages })` function. It returns a
configured locale string, synchronously or asynchronously. Palamedes sets
`<html lang>` to that selection before startup; the SPA shell must tolerate
that intentional correction during hydration. The host owns path, query and
browser preference precedence and changes locale by document navigation or
reload.

The allowlist must come from a separately reviewed host policy, never by blindly
hashing every script in the document at build time. Set script count and byte limits appropriate for the host. Digests cover the complete
original element bytes and must match in count and order. Unknown or changed
scripts fail the build. Review framework output whenever an approved digest
changes. The transform rejects remote scripts, deferred classic scripts, unsupported
module attributes, existing import maps, unsafe policy URLs and invalid
generated map bindings. Remove `defer` from classic scripts or handle that
document separately when its startup order depends on them.
It supports local root-relative JavaScript URLs and optional `assetBase` for a
root-relative deployment prefix ending in `/`. The returned `cspHashes` are
SHA-256 hashes of exact generated import-map and inline-module contents; they
are distinct from element-approval digests. `bootstrap.integrity` is the
bootstrap's SRI digest. The host must also allow its existing classic scripts,
policy module and local executable assets under its CSP. No `unsafe-inline` is
required for scripts. The allowlist treats each approved inline module as trusted
code; it does not inspect its imports. The CSP must restrict their origins.
Initial catalog recovery observes dependencies associated with the document's
modulepreload links and external module entries, plus failures reported by the
restored module elements. A host whose startup launches additional unpreloaded
dynamic imports must handle rejected imports itself. A trusted `<template data-palamedes-error>` can provide
catalog-independent initial-failure markup; otherwise Reload and Home are shown.
The host supplies a catalog-independent boundary for lazy failures.

For React Router prerendering, use React Router 8.5 or newer, configure the
server adapter with `catalogDelivery: false`, and keep `ssr: false`. The
prerender environment must select Node exports, for example
`environments: { ssr: { resolve: { conditions: ["node", "module", "development|production"] } } }`
in Vite. See the packed static proof in
`tests/fixtures/react-router-static` and run
`node scripts/proof-static-react-router.mjs` after building the package graph.
The proof requires Chromium and a free local port 25120.
