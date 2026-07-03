# Stability And Versioning

Palamedes 1.0 makes the app-facing surfaces below SemVer-stable. This page
defines what app teams can depend on and where changes may still happen between
minor releases.

## Versioning From 1.0

All publishable Palamedes packages ship in lockstep.

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

| Surface                                               | Tier     | Notes                                                                                                                         |
| ----------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `@palamedes/core` runtime API                         | Stable   | `createI18n`, message descriptors, locale activation, and source-message fallback behavior are app-facing.                    |
| `@palamedes/runtime`                                  | Stable   | `getI18n`, `setClientI18n`, and the server runtime contract are the public transform target.                                  |
| `@palamedes/react` and `@palamedes/solid`             | Stable   | Runtime components and macro entry points are public app APIs.                                                                |
| `@palamedes/vite-plugin` and `@palamedes/next-plugin` | Stable   | Plugin options and `.po` loading behavior are public integration APIs.                                                        |
| `@palamedes/config`                                   | Stable   | Config file names, `defineConfig`, and the config schema are public.                                                          |
| `@palamedes/cli`                                      | Stable   | Documented commands and flags are public. New commands may appear in minors.                                                  |
| Source-string-first PO catalogs                       | Stable   | Message identity is `message + context`. Catalog files remain user-owned.                                                     |
| FCL catalog storage                                   | Preview  | Supported through config, CLI, and native catalog APIs; app-facing framework imports remain PO-loader based for now.          |
| Macro syntax                                          | Stable   | Supported macros remain the authoring model. Unsupported explicit IDs are not a compatibility target.                         |
| `@palamedes/core-node`                                | Preview  | It is usable directly, but primarily exists as the JS boundary to the Rust core. Generated type details may change in minors. |
| Platform native packages                              | Internal | `@palamedes/core-node-*` packages are optional dependency carriers for native binaries. Apps should not import them directly. |
| `palamedes` and `create-palamedes`                    | Reserved | Placeholder top-level packages exist, but there is no supported first-run entry yet.                                          |
| Compiled catalog artifact internals                   | Preview  | Public loaders can consume them; the internal representation may evolve in minors.                                            |
| `crates/*` Rust APIs                                  | Preview  | The Rust crates support the Node toolchain today. They are not yet a separately promised public Rust SDK.                     |

## Stable Surfaces

Palamedes treats these as stable adoption surfaces:

- `palamedes.yaml` schema and config discovery
- source-string-first PO catalogs using `message + context` identity
- documented FCL storage configuration and conversion workflows
- documented `pmds` commands and flags
- Vite and Next plugin options documented in package READMEs
- runtime access through `getI18n()`
- `createI18n()` and descriptor-based lookup behavior
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
- future managed translation workflow bridges

## Deprecation Policy

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
- platform support is documented in one place
- preview/internal surfaces are clearly labeled or promoted with tests and docs

See [Migrating to Palamedes 1.0](./migrations/1.0.0.md) for the breaking
catalog-format and metadata changes that were handled in the stabilization
release.
