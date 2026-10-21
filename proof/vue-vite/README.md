# Vue 3 + Vite spike

Vue can use Palamedes today through the existing framework-neutral Vite
integration, with messages authored in TypeScript modules and called from Vue
single-file components. This private proof explores that path without adding a
published adapter or claiming full Vue support.

## Run the proof

Use the repository prerequisites in [CONTRIBUTING.md](../../CONTRIBUTING.md).
From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @palamedes/vite-plugin... --filter @palamedes/cli... --workspace-concurrency=1 build
pnpm --dir proof/vue-vite install --frozen-lockfile
pnpm --dir proof/vue-vite extract
pnpm --dir proof/vue-vite test
pnpm --dir proof/vue-vite dev
```

Open <http://127.0.0.1:4072>. If Chromium is missing, run
`pnpm --dir proof/vue-vite exec playwright install chromium` before the test.

The nested workspace and lockfile isolate experimental Vue tooling from the
main workspace. Local `link:` dependencies use the Palamedes packages built
above; this tests the checked-out source rather than a published release.

## What it proves

The browser suite runs against both the Vite development server and a production
build, using English, French, and Spanish catalogs. It checks:

- `t` interpolation through Vue `ref` and `computed`, including input changes.
- `plural` exact-zero, singular, and plural branches as the traveler count changes.
- One message fragment for the active locale at initial render, followed by one
  more when `defineAsyncComponent` loads the packing tip. Other languages are
  not fetched, and reactive updates reuse the loaded fragments.
- A language link performs a document navigation, installs the new locale,
  and resets Vue state, as required by [ADR-007](../../adr/007-locale-is-fixed-for-a-browser-document.md).
- Unsupported locale input selects English. A failed initial production catalog
  request renders the plugin's error page instead of partially translated UI.

The app uses `palamedes({ framework: "none", mdx: false })` alongside the official
Vue plugin. `messages.ts` and the lazily imported `packing.ts` use ordinary
`@palamedes/core/macro` imports. Palamedes handles compilation, runtime
initialization, and active-locale delivery; the app has no catalog imports or
manual runtime setup. Vue components use the resulting strings in templates
and attributes. The native CLI extracts ten messages into ordinary `.po` files.

## Current limits

Direct macro imports in a `.vue` file do not work with this configuration.
`test/fixtures/Inline.vue` reproduces the build failure, and the suite checks
that it still fails with the macro compilation diagnostic. The current
Palamedes transform filter handles JavaScript and TypeScript modules rather
than raw Vue SFCs. Moving the message functions into `.ts` files is the working
path demonstrated here. Template extraction, Vue rich-text components, SFC
source maps, catalog HMR, SSR, and Nuxt are outside this proof.

The initial toolchain probe also found that `vue-tsc@3.3.13` fails to start with
the repository's TypeScript 7.0.2: `ERR_PACKAGE_PATH_NOT_EXPORTED` for
`typescript/lib/tsc`. This proof pins TypeScript 6.0.3 and passes `vue-tsc`
without skipping declaration checks. The main workspace keeps its existing
TypeScript versions. Vue's [TypeScript guide](https://vuejs.org/guide/typescript/overview.html)
describes the separate SFC type-checking step.

## Suggested next step

The runtime and catalog-delivery path is viable for a Vue SPA. Before offering
first-class Vue support, investigate SFC-aware extraction and transformation,
source-map preservation, rich text, and Vue error boundaries for failed lazy
catalog requests. Keep those integrations thin over the shared compiler and
runtime, following [ADR-008](../../adr/008-framework-adapter-architecture.md).
