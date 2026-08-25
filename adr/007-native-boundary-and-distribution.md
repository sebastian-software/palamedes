# ADR-007: Native Boundary and Distribution

**Status:** Accepted
**Date:** 2026-03-17
**Revised:** 2026-08-25

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

- four Rust crates: the semantic core, Node binding, native CLI, and plugin SDK
- two platform-aware TypeScript wrapper families: `@palamedes/core-node` and
  `@palamedes/cli`
- six platform-specific packages for each family, carrying either the compiled
  Node addon or CLI binary artifacts

### Native Target Policy

A native target is a Node operating-system, architecture, and (on Linux) C
library combination. It produces one package in each native family and requires
a matching release build, smoke test, optional dependency, resolver branch, and
support documentation.

Palamedes supports exactly these six targets:

- macOS arm64
- Linux x64 with glibc
- Linux x64 with musl
- Linux arm64 with glibc
- Linux arm64 with musl
- Windows x64 with MSVC

This keeps the native surface aligned with current developer machines and
server/container deployments. The two Linux C libraries are separate targets:
an addon compiled against glibc cannot be treated as an Alpine-compatible musl
addon.

Intel macOS (`darwin/x64`) and Windows on ARM (`win32/arm64`) are deliberately
unsupported. A build runner being available, or an architecture being able to
emulate another one, is not sufficient reason to multiply every release's
artifacts and maintenance surface. On Apple Silicon, users should install an
arm64 Node runtime rather than run an x64 Node runtime under Rosetta.

A new target needs evidence of recurring user demand or a deployment
requirement that the six targets cannot reasonably cover. Before it is accepted,
it must have a reproducible native build and load smoke test on a matching
runner, and its ongoing cost must be justified across both the CLI and Node
binding package families. Adding a target is therefore an explicit update to
this ADR and the platform-support contract, not an incidental packaging change.

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
- Every release publishes and verifies twelve native artifacts: one CLI binary
  and one Node addon for each of the six supported targets.
- Unsupported Node processes fail explicitly and point users to a supported
  runtime, rather than silently selecting an emulated or incompatible binary.
- Future refinements may improve marshalling details, but the coarse-grained boundary principle remains the stable rule.
