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

## Options

```ts
interface PalamedesPluginOptions {
  include?: FilterPattern;
  exclude?: FilterPattern;
  enablePoLoader?: boolean;
  configPath?: string;
  cwd?: string;
  skipValidation?: boolean;
  failOnMissing?: boolean;
  /** @deprecated Invalid and unsupported ICU is always fatal in v2. */
  failOnCompileError?: boolean;
  framework?: "react" | "solid" | "none";
  runtimeModule?: string;
  keepSourceFallbacks?: boolean;
  mdx?: PalamedesMdxConfig | false;
  experimentalGraphSplitting?: boolean | { localeBinding?: "embed" | "import-map" };
  environment?: "auto" | "server";
}
```

Defaults:

- `include`: JavaScript/TypeScript (`/\.([cm]?[jt]s|[jt]sx)$/`) and Vue/Svelte components (`/\.(vue|svelte)$/i`)
- `exclude`: `/node_modules/`
- `enablePoLoader`: `true`
- `failOnMissing`: `false`
- `failOnCompileError`: deprecated compatibility option; it no longer
  downgrades invalid or unsupported ICU to a warning.
- `framework`: `"react"`
- `runtimeModule`: `"@palamedes/runtime"`
- `keepSourceFallbacks`: `false`
- `mdx`: values from Palamedes config with React defaults; `false` disables MDX
- `experimentalGraphSplitting`: deprecated; delivery is automatic and `false` is rejected
- `environment`: `"auto"`

`framework` states which UI framework the app compiles for and selects the
component contract for generated MDX modules. Solid apps must set
`framework: "solid"`.

Macro and generated MDX runtime lookups always use the plain, hook-free getter.
Locale changes require document navigation. `runtimeModule` is an advanced
override for only the macro transform's module path.

`environment: "auto"` reads the Vite environment to tell server builds from
browser builds. Bundlers without Vite environments, such as tsdown or
standalone Rolldown building a Node backend, need `environment: "server"`.

`keepSourceFallbacks` defaults to `false` in every environment. Set
`keepSourceFallbacks: true` to retain authored text for diagnostics. Missing
compiled messages throw; source metadata never supplies replacement output.
Valid translation fallbacks are compiled by the native compiler.

Generated MDX modules can set `mdx.runtime-module` in `palamedes.yaml` or
`mdx.runtimeModule` on the plugin when integrating a custom runtime.

Compiled delivery follows the evaluated module graph automatically. Development
awaits the active locale's generated fragment before running its source module.
When an edit changes the set of messages a module uses, development refreshes
that module's fragments through HMR, even when no catalog file changed.
Production emits locale-bound import maps and separate executable fragments.
Set the document's `lang` before its module entry runs; the adapter initializes
the client instance. Locale changes require document navigation.

Vite's resolved `base` must be root-relative, such as `/app/`, or an absolute
URL. Relative bases are rejected because nested document URLs would resolve
catalog URLs differently.

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
configured automatically. Solid must use
`solid({ extensions: [".mdx"] })`. React MDX requires Vite 8 or `rolldown-vite`
because the generated JSX module type needs Rolldown; plain Rollup-based Vite 7
and older projects can set `mdx: false` while keeping macros and catalog loading.
See [MDX
messages](../mdx.md) for authoring and configuration.

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
remain adapter-owned. Template expressions, automatic template-text extraction,
and Vue rich-text components are not supported. See the runnable
[Vue proof](../../proof/vue-vite/README.md).

## Svelte components (Preview)

Use `plugins: [palamedes({ framework: "none", mdx: false }), svelte()]`, where
`svelte` comes from `@sveltejs/vite-plugin-svelte`. Palamedes must run first.
Core macros work in inline JavaScript or TypeScript instance and module scripts.
Instance-level calls are valid because Svelte runs that code per component;
module-level calls must be inside functions. Import macros in the same script
block as their calls. Native CLI extraction and transforms retain original
`.svelte` references, markup, styles, and source maps.

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
before initial and dynamically imported components execute. Applications do not
import catalogs or initialize the runtime manually. Locale controls navigate to
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
linked from a workspace. On Vite 6 and newer this applies to every server
environment, such as the `rsc` environment used by Waku and React Router RSC,
not only to `ssr`. It also keeps `@palamedes/waku` in that graph so the adapter
shares Waku's request store. Existing `noExternal` entries and `true` are
preserved. Applications do not need a Palamedes-specific `ssr.noExternal` or
`resolve.noExternal` configuration.

`@palamedes/vite-plugin/delivery` exports `createViteCatalogDelivery({
clientDirectory, development?, manifestName? })`. Server code calls
`getLocaleBinding(locale)` on it and pipes HTML through
`createDocumentTransform(binding, { nonce?, errorHtml? })`. The Solid, TanStack,
Waku, and React Router RSC adapters do this internally. React Router Framework
Mode has no adapter package, so the application makes these calls in
`app/entry.server.tsx`; see the
[React Router Framework Mode guide](./react-router.md). `errorHtml` is trusted,
catalog-independent host markup; the default view provides Reload and Home.
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
