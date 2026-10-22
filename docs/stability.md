# Stability And Versioning

Palamedes 1.0 makes the app-facing surfaces below SemVer-stable. This page
defines what app teams can depend on and where changes may still happen between
minor releases.

## Versioning From 1.0

All publishable Palamedes packages ship in lockstep.

Published packages declare Node.js `>=22.0.0` unless a package has a specific
runtime reason to require a higher Node floor. The canonical per-package list is
the [platform support table](./platform-support.md#nodejs-requirements), which
is checked against the published `engines.node` fields. The `@palamedes/cli-*`
platform shells intentionally leave Node compatibility to their `@palamedes/cli`
wrapper and therefore omit an engine declaration; the `@palamedes/core-node-*`
native addons are loaded directly by Node and declare `>=22.0.0`. The repository
development and CI floor is stricter: contributors should use Node.js `>=22.22`,
matching the root `package.json`, repository Node badge, and contribution guide.

From 1.0 onward:

- major releases may include breaking changes to Stable surfaces
- minor releases add compatible behavior to Stable surfaces
- patch releases are compatible bug fixes

Preview, Internal, and Reserved surfaces are not SemVer-stable adoption
contracts. They should still receive migration notes when practical, but they
may change faster than Stable surfaces.

## Stability Tiers

- **Stable**: app-facing surface covered by SemVer.
- **Preview**: usable, but still allowed to change as real adoption clarifies
  the API shape.
- **Internal**: implementation detail. Apps should not import or depend on it
  directly.
- **Reserved**: package name or surface intentionally held for future work, with
  no supported adoption path yet.

| Surface                                               | Tier     | Notes                                                                                                                                                                                               |
| ----------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@palamedes/core` runtime API                         | Stable   | `createI18n`, compiled message lookup, locale activation, and missing-message errors are app-facing.                                                                                                |
| `@palamedes/runtime`                                  | Stable   | `getI18n`, `setClientI18n`, and the server runtime contract are the public transform target.                                                                                                        |
| `@palamedes/react` and `@palamedes/solid`             | Stable   | Runtime components and macro entry points are public app APIs.                                                                                                                                      |
| `@palamedes/vite-plugin` and `@palamedes/next-plugin` | Stable   | Plugin options and `.po` loading behavior are public integration APIs.                                                                                                                              |
| `@palamedes/waku`                                     | Preview  | ESM-only Waku handler interceptor and request resolver contract; Waku currently exposes the required APIs as unstable.                                                                              |
| `@palamedes/tanstack`                                 | Stable   | TanStack Start server-function middleware and its request resolver contract are public integration APIs.                                                                                            |
| `@palamedes/remix`                                    | Preview  | Full-stack Remix v3 adapter; stable Remix `3.0.0` with Node `>=24.3.0`; all four strategies have public HTTPS browser proofs; the adapter contract remains Preview for that exact upstream version. |
| `@palamedes/react-router-rsc`                         | Preview  | Opt-in React Router RSC Framework Mode request scope; the upstream RSC contract remains experimental.                                                                                               |
| `@palamedes/config`                                   | Stable   | Config file names, `defineConfig`, and the config schema are public.                                                                                                                                |
| `@palamedes/cli`                                      | Stable   | Documented commands and flags are public. New commands may appear in minors.                                                                                                                        |
| `@palamedes/eslint-plugin`                            | Preview  | Thin ESLint/Oxlint facades over native diagnostics; Oxlint's JavaScript plugin API is still alpha.                                                                                                  |
| `@palamedes/extractor` and `@palamedes/transform`     | Preview  | Published advanced-tooling APIs; their integration boundaries may evolve before promotion.                                                                                                          |
| `pmds` binary plugin protocol                         | Preview  | Protocol v1 is version-negotiated; native package resolution and capabilities may evolve before promotion.                                                                                          |
| Source-string-first PO catalogs                       | Stable   | Message identity is `message + context`. Catalog files remain user-owned.                                                                                                                           |
| FCL catalog storage                                   | Preview  | Supported through config, CLI, and native catalog APIs; app-facing framework imports remain PO-loader based for now.                                                                                |
| Macro syntax                                          | Stable   | Supported macros remain the authoring model. Unsupported explicit IDs are not a compatibility target.                                                                                               |
| `@palamedes/core-node`                                | Preview  | It is usable directly, but primarily exists as the JS boundary to the Rust core. Generated type details may change in minors.                                                                       |
| `@palamedes/core-node-*` platform packages            | Internal | Optional dependency carriers for native Node addons; apps should not import them directly.                                                                                                          |
| `@palamedes/cli-*` platform packages                  | Internal | Optional dependency carriers for native CLI executables; apps should not import them directly.                                                                                                      |
| `palamedes` and `create-palamedes`                    | Reserved | Placeholder top-level packages exist, but there is no supported first-run entry yet.                                                                                                                |
| Compiled catalog artifact internals                   | Preview  | Public loaders can consume them; the internal representation may evolve in minors.                                                                                                                  |
| `palamedes-build` and `palamedes-i18n` Rust crates    | Preview  | Experimental, unpublished Cargo integration and external catalog runtime. Text, display arguments, string selects, and cardinal/ordinal plurals; see the [Rust guide](./rust-applications.md).      |
| Other `crates/*` Rust APIs                            | Preview  | Primarily toolchain APIs; no separately stable public Rust SDK contract is promised.                                                                                                                |

### Vue SFC Preview contract

Vue 3 + Vite has an experimental, browser-only integration through
`@palamedes/vite-plugin`. Core macros work inside inline `<script setup>` and
`<script>` blocks, with native extraction, transforms, source maps, and automatic
active-locale catalog delivery. The [Vue proof](../proof/vue-vite/README.md)
verifies the shared booking demo in English, German, French, and Spanish.

This SFC integration is **Preview**, even though the surrounding Vite plugin's
existing APIs are Stable. Template-expression macros, automatic template-text
extraction, and Vue rich text are not supported. The Vite proof is browser-only
and separate from the supported server-framework example matrix.

### Svelte component Preview contract

The private [Svelte + Vite proof](../proof/svelte-vite/README.md) verifies Svelte 5
with the shared booking demo in English, German, French, and Spanish. Inline
instance and module scripts support core macros through native extraction and
transforms, with original source maps and automatic active-locale catalog
fragments for initial and dynamically imported components.

This integration is **Preview**, browser-only, and outside the supported
server-framework example matrix. Template-expression macros, automatic template
text extraction, Svelte rich text, catalog HMR, and non-JS/TS preprocessors are
not verified. SvelteKit SSR has a separate proof below.

### SvelteKit SSR Preview contract

The private [SvelteKit proof](../proof/sveltekit-ssr/README.md) verifies SvelteKit
3.1.0 with Svelte 5.57.2, Vite 8.2.2, and the Node adapter 6.0.0. Its local
integration reuses the native component compiler and existing Vite catalog
delivery. Development and production checks cover the shared four-language
booking demo, translated HTML without JavaScript, matching hydration, lazy
components and routes, endpoint macros, overlapping request isolation, locale
navigation, and production catalog failure UI. The production build runs from
a separate directory without source catalogs, workspace packages, or native
tooling.

This is a **Preview** proof outside the six-family server example matrix. No
SvelteKit package is published. It targets a root-mounted, same-origin Node
deployment with query-selected locale, a fixed time zone, and absolute asset
paths. Other adapters, CDN/subpath deployment, prerendering, streaming loads,
remote functions, catalog HMR, and the four-strategy matrix remain unverified.

### Nuxt SSR Preview contract

The private [Nuxt proof](../proof/nuxt-ssr/README.md) verifies Nuxt 4.6.2 with
Vue 3.5.44, Vite 8.3.4, and Nitro 2.13.5 on Node.js. The local module reuses SFC
macros and native extraction. Its development and production browser checks
cover four-language SSR HTML without JavaScript, hydration, lazy components and
pages, Nitro API handlers, parallel request isolation, and document locale
navigation. Production initial and async-component catalog failures have
catalog-independent recovery paths.

There is no published Nuxt package. This **Preview** proof targets a root-mounted,
same-origin Node deployment with query-selected locale and a fixed time zone.
Other Nitro presets, CDN or subpath deployment, prerendering, streaming, islands,
catalog HMR, and the four-strategy example matrix are not verified. It does not
establish support for arbitrary Vue SSR hosts.

### Waku Preview contract

The examples verify Waku `1.0.0-rc.3` with React, React DOM, and
`react-server-dom-webpack` `19.3.1` on Node.js 22.22 or newer. Upstream
Waku is a release candidate, not a beta or stable 1.0 release. Its fixed public
APIs do not cover the explicitly unstable request and nonce APIs used here.

`@palamedes/waku` remains **Preview**: its interceptor reads
`unstable_getRequest`, and host CSP setup uses `unstable_setNonce` in Waku's
render scope. The catalog middleware uses the public Hono middleware contract;
it cannot replace request access inside that render scope. Reconsider the
adapter's SemVer tier when Waku provides stable equivalents and request
isolation, server actions, streams, catalog recovery, and CSP have been
reverified. Waku reaching stable 1.0 alone does not promote the adapter.

This adapter tier is separate from the repository's unreleased Palamedes v2
publication preview. The release hold applies to all v2 packages; after v2
publication, Waku remains Preview until that boundary is resolved.

## Stable Surfaces

Palamedes treats these as stable adoption surfaces:

- `palamedes.yaml` schema and config discovery
- source-string-first PO catalogs using `message + context` identity
- documented FCL storage configuration and conversion workflows
- documented `pmds` commands and flags
- Vite and Next plugin options documented in package READMEs
- TanStack Start server-function middleware documented in `@palamedes/tanstack`
- runtime access through `getI18n()`
- `createI18n(options?)` and descriptor-based lookup behavior
- React and Solid runtime components and macro package names

If one of these must change after 1.0, the release should include:

- a changelog entry calling out the break
- a migration note or replacement path
- a deprecation period when both old and new paths can reasonably coexist

## Surfaces That May Still Move

These areas are allowed to change faster while the project learns from real
adoption:

- generated native binding type details
- compiled artifact internals
- FCL import support in framework adapters
- package layout for new native platform targets
- benchmark fixture shape and reporting fields
- internal package boundaries between plugins and transform/core-node helpers
- optional Palamedes+ workflow bridges
- binary plugin host capabilities beyond protocol v1

## Deprecation Policy

### Palamedes v2 transition

The v2 implementation unifies application runtimes around compiled messages on
server and client and makes framework catalog loading transparent. It removes
the legacy runtime ICU parser mode and changes compilation and runtime failure
behavior. These are coordinated major-release changes, not compatible 1.x
patches or minors. The published 1.x contract remains in force until migration.

V2 must include migration guidance for removed APIs and options, adapter setup,
and error handling. Existing `compiled` import paths may remain as aliases to
the unified implementation without preserving the old parser mode. There is
no permanently supported legacy mode within v2 and no committed release date.
See the [v2 migration guide](migration-v2.md), the living ADRs, and the
[catalog-delivery evidence report](../benchmarks/catalog-delivery/README.md)
for the implementation contract and verification record.

### General policy

When a stable surface needs to change, prefer this path:

1. Add the replacement.
2. Document the replacement in the release notes.
3. Keep the old path working for at least one minor release when practical.
4. Emit a clear diagnostic or runtime warning if the old path can be detected.
5. Remove it in a later major release.

Security fixes, broken behavior, and unsupported preview/internal surfaces may
skip the full deprecation window when keeping compatibility would be misleading
or unsafe.

## What 1.0 Means

The 1.0 release means:

- app-facing packages follow standard SemVer
- config, CLI, macro syntax, catalog identity, and runtime APIs are stable
- [platform support is documented in one place](./platform-support.md)
- preview/internal surfaces are clearly labeled or promoted with tests and docs

See [Migrating to Palamedes 1.0](./migrations/1.0.0.md) for the breaking
catalog-format and metadata changes that were handled in the stabilization
release.
