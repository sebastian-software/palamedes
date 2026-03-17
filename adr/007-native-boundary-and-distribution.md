# ADR-007: Native Boundary and Distribution

**Status:** Accepted
**Date:** 2026-03-17

## Context

If Palamedes is Rust-first, it still needs a practical delivery and integration model for Node-based tooling.

That boundary has to satisfy a few constraints:

- usable in normal Node.js environments today
- compatible with CLI and bundler plugin use cases
- coarse-grained enough that the boundary does not become the new source of complexity
- realistic to package and distribute across supported platforms

At the same time, Palamedes should avoid turning the binding layer into a second semantic API surface.

## Decision

Palamedes uses native Node bindings via `napi-rs` and distributes them through platform-specific packages behind `@palamedes/core-node`.

The boundary rules are:

- prefer coarse native operations over fine-grained helper exports
- keep the TypeScript wrapper thin and ergonomic
- allow simple serialized payloads where they keep the boundary straightforward
- do not treat the binding layer as the primary place to model i18n semantics

The package model is:

- one Rust core crate
- one Rust Node binding crate
- one platform-aware TypeScript wrapper package
- platform-specific native packages that carry the compiled binary artifacts

## Alternatives Considered

### 1. WASM-first delivery

Rejected because the immediate use cases are Node-centric and the packaging/runtime trade-offs were not worth taking as the initial core path.

### 2. Fine-grained native APIs

Rejected because they encourage semantic drift at the boundary and increase cross-language chatter.

### 3. Keep native code as internal implementation detail only

Rejected because the native core is not just an optimization layer; it is the main semantic engine.

## Consequences

- `@palamedes/core-node` should expose a compact set of meaningful operations.
- Boundary design should optimize for stable workflow calls, not for perfect one-to-one exposure of internal Rust modules.
- Native artifact distribution is part of the product architecture, not an afterthought.
- Future refinements may improve marshalling details, but the coarse-grained boundary principle remains the stable rule.
