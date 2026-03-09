# ADR-011: Rust Core with Thin Node/TypeScript Wrappers

**Status:** Accepted
**Date:** 2026-03-09

### Context

Palamedes currently implements its main build-time logic in TypeScript:

- macro transformation
- message extraction
- PO catalog orchestration
- parts of ICU and message ID handling through `pofile-ts`

This keeps the hot path split across JavaScript and Rust-backed dependencies, even though the core computational work is increasingly Rust-oriented:

- OXC is Rust-based
- the future `pofile` core is Rust-based

The project goal is to keep more of the execution path in Rust and reduce the TypeScript layer to host integration and package ergonomics.

### Decision

Adopt a Rust-core architecture for Palamedes.

The target layering is:

1. external `pofile` crate as the foundational PO/ICU/catalog dependency
2. a Palamedes Rust core for OXC-based transform and extraction flows
3. a native Node binding layer exposing coarse-grained operations
4. thin TypeScript wrappers for CLI, Vite, Next.js, and package-facing APIs

Phase 1 will target native Node.js bindings rather than WASM.

### Consequences

- Transform and extraction should move into Rust instead of remaining TypeScript-first.
- TypeScript packages should become orchestration layers for config, filesystem, watcher, and framework integration.
- Native packaging and release complexity will increase.
- Public APIs may be preserved where useful, but internal compatibility is not a goal.
- Follow-up ADRs should capture binding technology, source map strategy, and native distribution decisions.
