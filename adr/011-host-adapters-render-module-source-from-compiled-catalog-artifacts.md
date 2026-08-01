# ADR-011: Host Adapters Render Module Source from Compiled Catalog Artifacts

**Status:** Accepted
**Date:** 2026-03-17

## Context

Palamedes compiles configured catalogs into runtime lookup maps, but Vite and
Next do not consume that data directly. They consume generated JavaScript
modules.

The Rust core previously combined both responsibilities:

- compile catalog data into runtime messages
- render JavaScript module source for bundler loaders

That mixed a host-neutral concern with a host-specific one. It also kept `serde_json` in the Rust core solely to emit JavaScript-safe module source.

This is the wrong boundary. The host-neutral `palamedes` crate should own
catalog semantics and compilation. The Node host boundary should own JavaScript
module rendering.

## Decision

The Rust core returns compiled catalog artifacts, not JavaScript module source.

The rules are:

- `compile_catalog_artifact` returns compiled messages plus diagnostics and watch metadata
- it does not render ESM or CJS source code
- the `palamedes-node` workflow boundary renders the shared JavaScript catalog
  module consumed by Vite, Next, and Remix
- standalone TypeScript loader helpers render the same module contract when
  they receive an artifact directly
- generated modules preserve `messages` as `Record<string, string>` and attach
  precompiled ICU nodes through `defineCompiledCatalog()`
- constant messages are implied by their absence from the attached node map;
  invalid or unsupported messages carry a `false` marker and retain lazy
  runtime parsing
- the precompiled metadata is non-enumerable, so string lookup, object spread,
  and JSON serialization keep their existing public behavior

The intended stack is:

- Rust core compiles configured PO or FCL catalogs into runtime-ready message maps
- `palamedes-node` exposes that artifact through typed N-API bindings and a
  shared `compileCatalogModule()` host workflow
- the Rust core maps Ferrocat's ICU AST to Palamedes runtime nodes, while the
  host workflow renders the final ESM source
- Vite, Next, and Remix consume the shared module result

## Alternatives Considered

### 1. Keep JavaScript module rendering in Rust

Rejected because it couples the core to a specific host output format and keeps JavaScript-oriented escaping logic in the wrong layer.

### 2. Duplicate module rendering in every framework adapter

Rejected because generated catalogs now carry a versioned runtime-node
contract in addition to escaped string data. One Node-host workflow prevents
Vite, Next, and Remix from drifting on that contract. The standalone
TypeScript helper remains for custom integrations and has direct parity tests.

### 3. Replace public message strings with AST values

Rejected because applications and third-party integrations may inspect,
spread, or serialize `CatalogMessages`. Hidden precompiled metadata removes
browser parsing without changing those observable string values.

## Consequences

- The host-neutral Rust core does not render JavaScript module source.
- `palamedes-node` uses `serde_json` at the Node host boundary for safe ESM
  literals.
- `CatalogArtifactResult` exposes `messages` instead of `code`.
- First-party host adapters share `compileCatalogModule()` rather than
  maintaining framework-specific renderers.
- The core becomes more host-neutral and easier to reuse outside the current Vite/Next integrations.
- Catalog storage can evolve from PO-only to PO/FCL without moving JavaScript
  module rendering back into Rust.
- Generated catalogs do not parse valid ICU messages in the browser. Manual,
  copied, serialized, and invalid catalogs continue to use the bounded lazy
  parser and existing error fallback.
