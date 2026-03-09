# ADR-012: Native Node Bindings via napi-rs

**Status:** Accepted
**Date:** 2026-03-09

### Context

The Rust-core migration needs a practical phase-1 bridge into the existing Node.js-based Palamedes packages.

Requirements for that bridge:

- works in Node.js without requiring WASM
- supports a thin wrapper model for CLI and build-tool integrations
- can expose coarse-grained Rust operations to JavaScript
- keeps the Rust core independently testable

The project does not need browser or Edge compatibility for the first migration slice.

### Decision

Use `napi-rs` for the initial Node binding layer.

The binding shape for phase 1 is:

- one Rust core crate for Palamedes logic
- one `cdylib` binding crate for Node exposure
- one thin TypeScript package that loads the native module and presents the public API

The first spike is allowed to use JSON-based marshalling for structured payloads where that keeps the binding layer simple. The long-term direction remains coarse-grained Rust APIs with minimal boundary chatter.

### Consequences

- Palamedes can validate the Rust-core direction without committing to a WASM runtime.
- Native packaging becomes part of the delivery model.
- The binding layer stays separate from the Rust core and from package-facing TypeScript APIs.
- Future ADRs may still refine artifact distribution and reduce JSON marshalling in hot paths.
