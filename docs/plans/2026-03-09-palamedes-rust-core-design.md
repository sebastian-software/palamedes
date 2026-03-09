# Palamedes Rust Core Design

**Date:** 2026-03-09
**Status:** Approved
**Branch:** `t3code/plan-pofile-thin-ts-wrapper`

## Summary

Palamedes should move from a TypeScript-first implementation to a Rust-core architecture with a thin Node/TypeScript wrapper.

The target is not just to adopt the external `pofile` crate for PO handling. The larger goal is to keep the OXC-heavy and i18n-heavy execution path inside Rust:

- macro transform
- message extraction
- PO parsing and serialization
- catalog merge and compilation
- ICU parsing, validation, and formatting support
- message ID generation and plural logic

TypeScript should remain the integration layer for Node tooling, framework adapters, and package ergonomics.

## Goals

- Keep the hot build-time path in Rust wherever practical.
- Use external `pofile` as the foundational Rust dependency for PO/ICU/catalog logic.
- Reduce JS<->Rust boundary crossings to a few coarse-grained calls.
- Make `@palamedes/*` packages thin wrappers around a shared Rust core.
- Preserve current public package APIs where useful, but do not treat compatibility as a hard constraint.
- Record major architectural choices as ADRs during the migration.

## Non-Goals

- Moving browser runtime code into Rust.
- Supporting browser or Edge execution for the new core in phase 1.
- Preserving the current TypeScript internal module layout.
- Building a one-to-one TypeScript mirror of every Rust API.

## Recommended Architecture

### Layers

1. External Rust foundation: `pofile`
2. Palamedes Rust core: `palamedes`
3. Node binding layer: `palamedes-node` or similar
4. Thin TypeScript wrapper packages: CLI, Vite, Next.js, and optional typed internal wrapper package

### Responsibilities

**`pofile`**

- PO parser and serializer
- catalog transforms and merge helpers
- ICU parsing and compilation
- plural handling and message ID generation
- references and headers utilities

**`palamedes` Rust core**

- OXC-based macro detection
- OXC-based macro transform
- OXC-based message extraction
- validation and diagnostics
- orchestration around `pofile`

**Node binding layer**

- expose a stable native interface to Node.js
- map Rust errors into structured JS errors
- define coarse-grained input/output types

**TypeScript packages**

- load config
- read and write files
- watch filesystem changes
- integrate with Vite, Next.js, and CLI UX
- preserve package-facing ergonomics

## API Boundary

The TypeScript boundary should be intentionally coarse-grained.

Preferred native entry points:

- `transform(code, filename, options)`
- `extract(code, filename, options)`
- `parsePo(source, options)`
- `stringifyPo(po, options)`
- `mergeCatalogs(base, updates, options)`
- `compileCatalog(locale, catalog, options)`
- `validateMessage(message, locale, options)`
- `generateMessageId(message, context?)`

Guiding rule:

TypeScript should pass source strings, filenames, config-derived options, and simple catalog payloads. It should not prepare ASTs, walk PO structures, or reimplement semantic logic already owned by Rust.

## Why This Approach

### Rejected alternative: Rust only for `pofile`

This would reduce some duplicated PO logic, but it leaves the OXC-heavy transform and extraction path in TypeScript. That misses the main architectural benefit.

### Rejected alternative: move almost everything including host adapters into Rust

This is possible, but the integration code for Vite, Next.js, CLI parsing, config loading, and filesystem watching is naturally host-specific. Keeping that in Node/TypeScript produces a cleaner split with less complexity.

## Packaging Model

Phase 1 should target native Node.js bindings as the primary path.

Implications:

- no WASM requirement for phase 1
- native binaries will be required for supported platforms
- Vite and Next.js remain TypeScript packages that call into native bindings
- browser-side code remains unchanged

An optional WASM fallback can be reconsidered later if Edge/browser-adjacent execution becomes important.

## Migration Plan

### Phase 1: Rust workspace and bindings

- add a Cargo workspace to the Palamedes repo
- add a `palamedes` Rust crate
- add a Node binding crate, likely using `napi-rs`
- add a thin TS package or internal wrapper for the native module

### Phase 2: Foundation APIs via Rust

- route message ID generation through Rust
- route PO parse/stringify through `pofile`
- route catalog merge/helpers through `pofile`
- route ICU validation/compile through `pofile`

This validates the binding design before moving the larger OXC flows.

### Phase 3: Extractor migration

- move extraction logic from `packages/extractor-oxc` into Rust
- reuse OXC parsing/traversal in Rust
- return extracted messages in a stable binding format

### Phase 4: Transform migration

- move macro transform logic from `packages/oxc-transform` into Rust
- preserve transform behavior and source map semantics
- expose transform as a coarse-grained native operation

### Phase 5: Wrapper migration

- update CLI to call the native core
- update Vite plugin to call the native core
- update Next.js integration to call the native core
- keep browser-facing behavior unchanged

### Phase 6: Cleanup and consolidation

- remove obsolete TS-core implementations
- tighten package boundaries
- document native build and release workflow
- benchmark the new pipeline

## Suggested PR Slices

1. Rust workspace, binding crate, and minimal TS wrapper
2. `pofile`-backed PO/ICU/catalog operations
3. extractor migration to Rust
4. transform migration to Rust
5. CLI/Vite/Next migration to new core
6. cleanup, docs, benchmarks, and removal of old TS implementations

## Testing Strategy

- add fixture-based parity tests for extraction
- add fixture-based parity tests for transforms
- snapshot source maps where practical
- add roundtrip tests for PO parsing and serialization
- add catalog compilation tests across plural-heavy locales
- run wrapper-level integration tests from CLI/Vite/Next entry points

The key test principle is behavior parity at the package boundary, not file-by-file parity with the current TS implementation.

## Main Risks

- native binary distribution across macOS, Linux, and Windows
- correct source map generation from Rust transforms
- error reporting quality inside Vite and Next.js builds
- CI and release complexity for native artifacts
- accidental fine-grained JS<->Rust APIs that reintroduce serialization churn

## Success Criteria

- OXC-heavy processing stays in Rust end-to-end for transform and extraction
- PO/ICU/catalog operations run through external `pofile`
- TypeScript packages become orchestration layers rather than logic layers
- no frequent JS<->Rust ping-pong across the main execution path
- output remains functionally equivalent or better than the current implementation
- native distribution is practical for Palamedes users

## ADR Plan

This migration should create or update ADRs for major decisions instead of leaving them implicit in code.

Expected ADR checkpoints:

- Rust-core architecture as the new default direction
- native Node bindings as phase 1 deployment target
- external `pofile` as foundational dependency
- source map strategy for Rust transform
- packaging and release strategy for native binaries
- fallback strategy, if any, for unsupported environments

ADRs should be stored as individual numbered files under `adr/`, with `DECISIONS.md` acting as the index.

## Notes

The `brainstorming` skill expects a follow-up implementation planning step via a dedicated planning skill. That skill is not available in this session, so this document includes the implementation sequence directly as the fallback.
