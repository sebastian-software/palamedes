# ADR-011: Host Adapters Render Module Source from Compiled Catalog Artifacts

**Status:** Accepted
**Date:** 2026-03-17

## Context

Palamedes compiles `.po` catalogs into runtime lookup maps, but Vite and Next do not consume that data directly. They consume generated JavaScript modules.

The Rust core previously combined both responsibilities:

- compile catalog data into runtime messages
- render JavaScript module source for bundler loaders

That mixed a host-neutral concern with a host-specific one. It also kept `serde_json` in the Rust core solely to emit JavaScript-safe module source.

This is the wrong boundary. The Rust core should own catalog semantics and compilation. Host adapters should own JavaScript module rendering.

## Decision

The Rust core returns compiled catalog artifacts, not JavaScript module source.

The rules are:

- `get_catalog_module` returns compiled messages plus diagnostics and watch metadata
- it does not render ESM or CJS source code
- host adapters such as the Vite plugin and Next loader render the final module source from that compiled artifact
- simple host-side rendering duplication is acceptable when it keeps JavaScript code generation out of the Rust core

The intended stack is:

- Rust core compiles `.po` catalogs into runtime-ready message maps
- `palamedes-node` exposes that artifact through typed N-API bindings
- Vite and Next adapters render the final module source for their host environment

## Alternatives Considered

### 1. Keep JavaScript module rendering in Rust

Rejected because it couples the core to a specific host output format and keeps JavaScript-oriented escaping logic in the wrong layer.

### 2. Introduce a shared JavaScript module renderer in the core wrapper before moving loaders

Rejected for now because the rendering logic is small and duplication in the host adapters is preferable to reintroducing a centralized cross-host rendering abstraction too early.

## Consequences

- The Rust core no longer needs `serde_json` for catalog module generation.
- `CatalogModuleResult` exposes `messages` instead of `code`.
- Host adapters are responsible for rendering their own module source.
- The core becomes more host-neutral and easier to reuse outside the current Vite/Next integrations.
