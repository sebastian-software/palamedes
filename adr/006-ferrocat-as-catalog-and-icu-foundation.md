# ADR-006: Ferrocat as Catalog and ICU Foundation

**Status:** Accepted
**Date:** 2026-03-17

## Context

Catalog and ICU semantics are deep enough that Palamedes should not casually reimplement them in multiple places.

Those concerns include:

- PO parsing and serialization
- catalog updates and obsolete handling
- normalized parsed-catalog views
- ICU parsing and validation
- plural handling
- other host-neutral gettext and catalog semantics

If Palamedes owns too much of that stack directly, the project risks rebuilding a second general-purpose catalog library inside a product-focused repository.

At the same time, Palamedes still needs product-shaped workflows on top of those semantics:

- OXC-based extraction
- macro transformation
- config-aware catalog loading
- runtime module generation
- framework-specific orchestration

That means Palamedes needs a clean boundary, not just a dependency swap.

## Decision

`ferrocat` is the foundation for host-neutral PO, catalog, and ICU semantics in Palamedes.

`ferrocat` is the preferred home for:

- PO parsing and serialization
- catalog update semantics
- normalized parsed-catalog access
- ICU parsing and validation
- plural and gettext-adjacent catalog behavior
- other reusable host-neutral catalog primitives

Palamedes remains the home for:

- OXC-based source processing
- product-shaped workflow operations
- host-aware config and file orchestration
- runtime module code generation
- framework adapter behavior

Palamedes should delegate more general catalog-format concerns to `ferrocat` over time, but should not mirror the full low-level `ferrocat` surface into its public package APIs.

## Alternatives Considered

### 1. Keep catalog semantics primarily inside Palamedes

Rejected because it duplicates generic infrastructure inside a product repository and weakens the architectural boundary.

### 2. Expose a broad `ferrocat` mirror through Palamedes

Rejected because it would bloat the public API surface and confuse Palamedes-specific workflows with general catalog tooling.

### 3. Split semantics across multiple JavaScript packages

Rejected because it recreates the fragmentation that the Rust-first architecture is meant to remove.

## Consequences

- Palamedes should prefer high-level `ferrocat` APIs over bespoke catalog glue whenever the semantic fit is good.
- Remaining local catalog logic in Palamedes should be treated as candidate delegation material, not as a permanent second foundation.
- New generic catalog or ICU helpers should default to `ferrocat` unless they are clearly product-specific.
- The current open edge is the final catalog compilation/export step for runtime maps; until `ferrocat` owns that cleanly, Palamedes may retain a minimal local compile/export layer.
