# Native PO Pipeline Design

Date: 2026-03-12

## Goal

Replace the remaining `@lingui/cli/api`-based `.po` loading path in the Vite and Next.js integrations with a Palamedes-native pipeline.

The first cut should support both Vite and Next.js immediately and should follow the Rust-first architecture established in [ADR-015](/Users/sebastian/Workspace/business/palamedes/adr/015-rust-first-i18n-core-with-thin-host-adapters.md).

## Problem

The current `.po` loading path in:

- [packages/vite-plugin/src/index.ts](/Users/sebastian/Workspace/business/palamedes/packages/vite-plugin/src/index.ts)
- [packages/next-plugin/palamedes-po-loader.cjs](/Users/sebastian/Workspace/business/palamedes/packages/next-plugin/palamedes-po-loader.cjs)

still depends on `@lingui/cli/api` for:

- catalog resolution
- fallback resolution
- loading dependent files
- compilation diagnostics
- generating ESM module code

This keeps a substantial part of Palamedes' runtime catalog pipeline outside the native core and duplicates domain logic across host adapters.

## Decision

Introduce a new coarse-grained native operation in `@palamedes/core-node`:

- `getCatalogModule(config, resourcePath)`

This operation will become the single entry point for `.po` loading in both Vite and Next.js.

## Architecture

### TypeScript responsibilities

TypeScript remains responsible for:

- loading `palamedes.config.*`
- passing normalized config plus `resourcePath` into the native core
- registering returned dependency paths with the current host
- forwarding generated `code` to the bundler
- applying host-side behavior flags such as `failOnMissing` and `failOnCompileError`

### Rust responsibilities

Rust owns the catalog domain pipeline:

- resolve the matching catalog and locale from `resourcePath`
- determine fallback files from the provided config
- read all relevant `.po` files
- parse `.po` content
- merge fallback chains
- produce missing-translation diagnostics
- apply pseudo-locale behavior
- compile messages into the Palamedes runtime representation
- generate final ESM module code
- return all actually used file paths for watch invalidation

## API Shape

### Input

`getCatalogModule(config, resourcePath)` receives:

- normalized Palamedes config
  - `rootDir`
  - `locales`
  - `sourceLocale`
  - `fallbackLocales`
  - `pseudoLocale`
  - `catalogs`
- `resourcePath`

### Output

The native call returns:

- `code: string`
- `watchFiles: string[]`
- `missing: Array<{ id: string; source: string }>`
- `errors: Array<{ message: string; id?: string }>`
- `resolvedLocaleChain?: string[]`

Notes:

- `watchFiles` are absolute paths
- `code` is final ESM module source
- no bundler-specific fields are part of the native contract

## Error Handling

### Throwing failures

The native call throws for hard failures:

- no matching catalog for `resourcePath`
- invalid path resolution
- missing expected catalog files
- unreadable files
- PO parse failures

### Structured diagnostics

The native call returns structured diagnostics for content-level issues:

- `missing`
- `errors`

This lets Vite and Next.js preserve their existing `failOnMissing` and `failOnCompileError` behaviors without pushing host policy into the core.

## Watch Invalidation

Fallback-aware loading means the effective output for one requested `.po` file may depend on multiple source files, for example:

- `de-AT.po`
- `de.po`
- `en.po`

Therefore the native result must include the full dependency set in `watchFiles`.

Host adapters map this to their local APIs:

- Vite: `this.addWatchFile(file)`
- Next.js webpack/Turbopack loader path: `this.addDependency(file)`

## Why This Boundary

This design keeps the configuration model host-local while moving the full catalog semantics into Rust.

That has four advantages:

- minimizes N-API boundary crossings
- avoids transferring large intermediate message structures back into JS
- centralizes catalog behavior for both Vite and Next.js
- keeps the core portable for future non-JS hosts

## Alternatives Considered

### TypeScript shared catalog loader

Rejected for the first cut because it would continue to keep a large part of the catalog pipeline outside the native core.

### Two native calls (`resolveCatalog`, `compileCatalog`)

Rejected because it would reintroduce orchestration churn at the JS boundary and weaken the Rust-first goal.

### Thin wrapper around Lingui internals

Rejected because it would not materially advance Palamedes' decoupling goals.

## Scope

Included in this round:

- new native `getCatalogModule(...)` operation
- Vite migration
- Next.js migration
- diagnostics and watch-file support

Explicitly not included:

- a standalone catalog compile CLI
- file emission
- non-JS host integrations
- full Lingui feature parity

## Validation

Implementation should be considered complete when:

- Vite `.po` imports no longer use `@lingui/cli/api`
- Next.js `.po` loading no longer uses `@lingui/cli/api`
- fallback-aware watch invalidation works through returned `watchFiles`
- missing/compile diagnostics preserve current host behavior
- build, tests, typecheck, and relevant `npm pack --dry-run` checks pass
