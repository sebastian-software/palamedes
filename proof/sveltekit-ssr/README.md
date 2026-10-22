# SvelteKit 3 SSR proof

This private proof renders the same Frontend Stage 2026 booking demo as the
other framework examples, using SvelteKit 3.1.0, Svelte 5.57.2, Vite 8.2.2, and
`@sveltejs/adapter-node` 6.0.0. It shares `EVENT` and the stylesheet from
`@palamedes/example-ui`. English, German, French, and Spanish macros live
directly in `.svelte` scripts and a server endpoint.

## Run

Follow the repository prerequisites in [CONTRIBUTING.md](../../CONTRIBUTING.md).
From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @palamedes/vite-plugin... --filter @palamedes/cli... --filter @palamedes/example-ui --workspace-concurrency=1 build
pnpm --dir proof/sveltekit-ssr install --frozen-lockfile
pnpm --dir proof/sveltekit-ssr extract
pnpm --dir proof/sveltekit-ssr test
pnpm --dir proof/sveltekit-ssr dev
```

Open <http://127.0.0.1:4075/?locale=de>. The nested workspace isolates framework
dependencies and TypeScript 6 tooling from the supported example matrix.
Install Chromium with `pnpm --dir proof/sveltekit-ssr exec playwright install chromium`
if needed.

For production, run `pnpm --dir proof/sveltekit-ssr preview` after building.
Deployment requires `build/` and a `package.json` containing `{"type":"module"}`;
start `HOST=127.0.0.1 PORT=4075 node build/index.js` from their parent directory.
The local integration reads the generated client manifest from `build/client`.
It does not read the checkout, PO files, or native compiler at runtime.

## Host integration

[`integration/vite.ts`](./integration/vite.ts) installs the existing Palamedes
Vite plugin before SvelteKit. Native extraction and transformation reuse the
same `.svelte` script support as the [browser proof](../svelte-vite/README.md).
There is no second macro compiler or message renderer. SvelteKit 3 configures
its adapter directly through `sveltekit(...)` in `vite.config.ts`. The proof
sets `paths: { relative: false }` so generated catalog import-map entries use
root-relative URLs.

[`integration/server.ts`](./integration/server.ts) implements SvelteKit's
`handle` hook. It selects the request language, creates a fresh runtime over
the shared immutable active-language server catalog, and runs both rendering
and endpoint dispatch inside `createServerI18nScope().run(...)`. Locale state
stays request-local across awaits and nested server fetches. No server-global
locale is mutated.

The hook sets document locale metadata before returning HTML and passes the
response through the existing Vite document delivery helper. The helper
installs the active-language import map before hydration imports execute.
Generated component dependencies initialize the client runtime and load their
compiled messages before component setup. Application components contain no
manual catalog imports, locale loaders, manifest handling, or import-map code.
SvelteKit's [hooks](https://svelte.dev/docs/kit/hooks) and
[state management guidance](https://svelte.dev/docs/kit/state-management)
define the request and hydration boundaries.

The booking page's server load calls the translated `/api/proof` endpoint;
the same endpoint handles the refresh button. It reports its runtime language
before and after an artificial await. An additional route and dynamically
imported component exercise catalog delivery after hydration.

## Verification

`pnpm --dir proof/sveltekit-ssr test` checks types, builds the Node output, and
runs real browsers against development and production. It verifies:

- Translated SSR HTML and JavaScript-disabled pages in all four languages,
  matching hydration, reactive ticket plurals, currency totals, cart actions,
  and endpoint refreshes.
- Three initial active-language component fragments, one lazy component
  fragment, and one lazy route fragment. Reopening a component reuses its
  module; same-language route changes stay in the document.
- Full document navigation for language controls, unsupported-language fallback,
  and mobile rendering without horizontal overflow.
- Twenty-four overlapping page requests and twenty-four overlapping endpoint
  requests per mode, mixing all languages and awaits to expose state leaks.
- Production initial-catalog failure reaches catalog-independent recovery UI;
  lazy failure reaches the component's await-block error UI while booking stays
  usable.
- Native CLI extraction without drift, plus a copied production build running
  outside the checkout without workspace dependencies or build tooling.

## Limits

This is a **Preview SSR spike**, not a published `@palamedes/sveltekit` package
or an addition to the six-family, four-strategy example matrix. The verified
host is root-mounted, same-origin Node with `?locale=` and a fixed
`Europe/Berlin` time zone. Other adapters, CDN or subpath assets, alternate
locale URL strategies, prerendering, deferred streaming loads, remote
functions, catalog HMR, and production process/worker memory benchmarks are
outside this proof.

Language controls use document navigation under
[ADR-007](../../adr/007-locale-is-fixed-for-a-browser-document.md). Ordinary links
preserve the current locale. Arbitrary client-router locale changes are not a
live-switching API. Template-expression macros, automatic template-text
extraction, Svelte rich text, and non-JS/TS preprocessors remain outside the
component contract; author macros in scripts and render their values in markup.
