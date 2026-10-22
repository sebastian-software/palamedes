# Nuxt 4 SSR proof

This private proof runs the Frontend Stage 2026 booking demo with Nuxt 4.6.2,
Vue 3.5.44, Vite 8.3.4, and Nitro 2.13.5 on Node.js. It reuses the Vue SFC
macro compiler and the shared `EVENT` data and stylesheet. English, German,
French, and Spanish messages live in `.vue` scripts and a Nitro API handler.

## Run

Use the repository prerequisites in [CONTRIBUTING.md](../../CONTRIBUTING.md).
From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @palamedes/vite-plugin... --filter @palamedes/cli... --filter @palamedes/example-ui --workspace-concurrency=1 build
pnpm --dir proof/nuxt-ssr install --frozen-lockfile
pnpm --dir proof/nuxt-ssr extract
pnpm --dir proof/nuxt-ssr test
pnpm --dir proof/nuxt-ssr dev
```

Open <http://127.0.0.1:4073/?locale=de>. The production output starts with
`NITRO_HOST=127.0.0.1 NITRO_PORT=4073 node proof/nuxt-ssr/.output/server/index.mjs`.
Install Chromium with `pnpm --dir proof/nuxt-ssr exec playwright install chromium`
if needed. The nested workspace keeps Nuxt dependencies out of the supported
example matrix. TypeScript 6.0.3 matches the Vue proof's `vue-tsc` constraint;
the type check covers Nuxt's app, server, and build configurations.

## Host adapter

[`modules/palamedes`](./modules/palamedes/module.mjs) is local proof code, not a
published `@palamedes/nuxt` package. It uses
[Nuxt Kit's Vite plugin hook](https://nuxt.com/docs/4.x/api/kit/builder#addviteplugin)
for the existing native extraction and transformation path. Nitro's Rollup
build uses the same plugin with an explicit server target for API macros.
No second macro compiler or catalog renderer is introduced.

The host policy in [`shared/locale.ts`](./shared/locale.ts) resolves `?locale=`
to one supported language, defaults to English, and fixes the time zone to
`Europe/Berlin`. The server plugin creates a fresh runtime for every request
and binds it to Nuxt's render event through `createServerI18nScope`. Nitro API
handlers run inside an explicit async scope. Their calls before and after an
await must retain the same request language.

The production Vite server build leaves the server-catalog virtual module for
Nitro to bundle once. Page rendering and API handlers share its lazy,
process-local catalog store. Locale and runtime instances remain request-local.
Development bundles the linked runtime explicitly so virtual catalog imports
are handled by the compiler rather than Node's ESM loader.

The server plugin writes the locale into Nuxt's serialized state and the HTML
attributes. The client plugin runs after Nuxt's payload revival and initializes
the same document-fixed runtime before page setup. SFC dependencies load the
active-locale compiled fragments before translated components execute. Nuxt's
[hydration guidance](https://nuxt.com/docs/4.x/guide/best-practices/hydration)
and [request lifecycle](https://nuxt.com/docs/4.x/guide/concepts/nuxt-lifecycle)
define those ordering boundaries.

The module embeds generated locale bindings in Nitro at build time and passes
HTML through the shared Vite catalog-delivery helper. Nitro publishes the
compiled catalog assets. Deployment needs only `.output`; it does not read
`.nuxt`, the source PO files, or the native compiler. Application components
contain no catalog loaders, manifest handling, or import-map code.

## Verification

`pnpm --dir proof/nuxt-ssr test` runs the production build and real browsers
against both development and production servers. It checks:

- Translated SSR HTML, JavaScript-disabled rendering, matching hydration,
  reactive ticket plurals and currency totals, cart actions, and server queries.
- Exactly three initial active-language SFC fragments, one additional async
  component fragment, and one additional Nuxt page fragment. Reopening a
  component reuses its module; same-language routes stay in the document.
- Full document navigation for language controls and English fallback for
  unsupported input, plus a narrow mobile viewport without overflow.
- Twenty-four overlapping page requests and twenty-four API requests per mode,
  mixing languages and artificial awaits to expose request-state leaks.
- Initial production catalog failure shows catalog-independent recovery UI;
  async-component failure reaches Vue's error component while booking stays usable.
- Native CLI extraction across both SFC and Nitro source, with no catalog drift.

## Limits

This is a **Preview SSR spike**, separate from the six supported server
framework families and their four-strategy matrix. It targets a root-mounted,
same-origin Node/Nitro deployment. The adapter deliberately uses a root-relative
Vite base for catalog import maps. CDN assets, subpath deployment, other Nitro
presets, prerendering, streaming, islands, alternative locale URL strategies,
and catalog HMR are not verified here.

Language controls use document navigation under
[ADR-007](../../adr/007-locale-is-fixed-for-a-browser-document.md). Application
links keep that locale; arbitrary router changes to the locale query are not a
live-switching API. Template macros, automatic template-text extraction, and
Vue rich-text components remain outside the SFC contract. Author core macros
in script blocks and render their results in templates.
