# Vue 3 + Vite proof

This private proof renders the same Frontend Stage 2026 booking demo as the
framework examples, using `EVENT` and the stylesheet from
`@palamedes/example-ui`. Messages are authored directly inside Vue single-file
components. The runtime proof is client-side; this Vite SPA does not simulate
the server result shown by the server-framework demos.

## Run the proof

Use the repository prerequisites in [CONTRIBUTING.md](../../CONTRIBUTING.md).
From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @palamedes/vite-plugin... --filter @palamedes/cli... --filter @palamedes/example-ui --workspace-concurrency=1 build
pnpm --dir proof/vue-vite install --frozen-lockfile
pnpm --dir proof/vue-vite extract
pnpm --dir proof/vue-vite test
pnpm --dir proof/vue-vite dev
```

Open <http://127.0.0.1:4072>. If Chromium is missing, run
`pnpm --dir proof/vue-vite exec playwright install chromium` before the test.
The nested workspace isolates Vue tooling from the main dependency graph;
local `link:` dependencies test the checked-out Palamedes source.

## Author messages inside components

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

Use `palamedes({ framework: "none", mdx: false })` before the official Vue Vite
plugin. Both `<script setup>` and normal `<script>` blocks support `js`, `jsx`,
`ts`, and `tsx`. Setup-level macros execute inside Vue's per-instance setup
function. Normal scripts retain Palamedes' function-scope requirement.
Import macros in the same script block as their calls.

The native CLI discovers `.vue` files through `include: [src]` and extracts the
36 source messages with original SFC references. The transform uses the same
Rust macro implementation, preserving templates, styles, source locations, and
source maps. No message helpers need to move into separate TypeScript files.
The Vite adapter imports the runtime getter through the generated catalog
dependency, keeping those imports inside the SFC script. The application has
no catalog imports or manual runtime setup.

## Verified behavior

The browser suite runs in development and production for English, French, and
Spanish. It covers the shared booking layout, reactive ticket plurals and
currency totals, a translated cart action, and client runtime calls.

The three initial SFCs load only their active-locale fragments. Opening the
async details component fetches one additional fragment; closing and reopening
it reuses that module. Language controls perform a document navigation and reset
Vue state, following [ADR-007](../../adr/007-locale-is-fixed-for-a-browser-document.md).
Unsupported locale input selects English. Failed initial delivery renders the
plugin's error page; failed lazy delivery reaches Vue's async error component
while the ticket panel remains usable. The suite also runs native
`pmds extract --check` and checks the narrow mobile layout for overflow.

Native tests cover both script kinds, import aliases and shadowing, original
Unicode source locations, invalid blocks, and script lookalikes in comments,
templates, styles, and custom blocks. The CLI regression checks source
discovery, extraction references, and catalog drift after editing a `.vue` file.

## Remaining limits

Template expressions and automatic template-text extraction, Vue rich-text
components, script preprocessors beyond JS/TS, catalog HMR verification, SSR,
and Nuxt are outside this proof. Author translation calls in the script and
render their results in the template.

`vue-tsc@3.3.13` cannot start with TypeScript 7.0.2 because `typescript/lib/tsc`
is not exported. This proof pins TypeScript 6.0.3 and type-checks SFCs without
skipping declaration checks. The main workspace retains its existing versions.
Vue's [TypeScript guide](https://vuejs.org/guide/typescript/overview.html)
describes the separate SFC type-checking step.
