# ADR-002: Rust-First Core with Thin Host Adapters

**Status:** Accepted
**Date:** 2026-03-17

## Context

The hot path in Palamedes is dominated by work that benefits from a native implementation:

- parsing and traversing source files
- extracting messages
- transforming macro syntax into runtime calls
- reading and writing catalogs
- validating and normalizing ICU message structures

If that path is split across many TypeScript layers and utility packages, the project pays several costs:

- semantic logic gets duplicated
- boundaries become chatty
- performance improvements are harder to realize end-to-end
- it becomes unclear which layer actually owns i18n behavior

At the same time, Palamedes still lives in JavaScript application ecosystems. Some responsibilities are naturally host-specific:

- config loading
- file watching
- bundler integration
- framework hooks
- CLI UX

That means Palamedes needs a strict ownership split rather than a vague "native helpers under a JavaScript toolchain" model.

## Decision

Palamedes adopts a Rust-first architecture.

The architectural rule is:

- Rust owns semantic i18n logic
- TypeScript owns host integration

Rust is the primary home for:

- macro transformation
- message extraction
- catalog reading and updating
- ICU parsing and validation
- compiled catalog preparation
- other host-neutral i18n semantics

TypeScript is the primary home for:

- project config discovery
- filesystem traversal and watch orchestration
- Vite and Next.js adapter wiring
- CLI UX and reporting
- packaging and host-facing API ergonomics

The TypeScript layer should call coarse native operations rather than rebuilding semantic pipelines locally.

## Alternatives Considered

### 1. TypeScript-first architecture with native helpers

This would keep JavaScript as the main execution model and use Rust only for selected hotspots.

Rejected because it preserves duplicated semantics and encourages the exact split-brain architecture Palamedes is trying to avoid.

### 2. Move everything possible into Rust

This would also push config loading, bundler integration, and other host-specific concerns into the native layer.

Rejected because those concerns are defined by JavaScript ecosystem APIs and become awkward when forced into the core.

### 3. Keep separate semantic pipelines per package

This would let CLI, bundler adapters, and low-level packages each own more local semantics.

Rejected because it weakens the product model and makes correctness harder to maintain.

## Consequences

- Native APIs should be shaped around meaningful domain operations instead of small helper calls.
- TypeScript packages should increasingly become orchestration layers over the same core semantics.
- Performance work should prefer end-to-end coarse operations over isolated helper acceleration.
- Architectural discussions should start by asking whether a concern is semantic and host-neutral or host-specific and orchestration-oriented.
