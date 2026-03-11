# Rust-First Core Rollout Plan

**Date:** 2026-03-12
**Status:** Approved

## Summary

Palamedes should move from "native helpers plus TypeScript orchestration with Lingui-owned runtime/config/catalog pieces" to a Rust-first i18n core with thin TypeScript host adapters.

This plan follows [ADR-015](../../adr/015-rust-first-i18n-core-with-thin-host-adapters.md).

The scope is intentionally lean:

- replace the Lingui-owned surfaces Palamedes still references internally
- keep TypeScript focused on host integration
- push semantic i18n work into Rust wherever doing so reduces boundary churn and strengthens portability

This is not a plan to rebuild the entire Lingui ecosystem.

## Scope

### In scope

- replace `@lingui/core`
- replace `@lingui/conf`
- replace `@lingui/cli/api` usage in the framework adapters
- update CLI, plugins, examples, docs, and tests to the Palamedes-first stack

### Out of scope for the first rollout

- a complete replacement for `@lingui/react`
- broad compatibility layers for every existing Lingui integration point
- non-JavaScript host integrations as deliverables
- a standalone catalog compiler product surface

## Current Internal Dependency Surfaces

### `@lingui/core`

Currently still appears in:

- runtime examples and README usage
- application-facing runtime setup expectations

Palamedes already owns the `getI18n()` contract, but not yet the full runtime core instance story.

### `@lingui/conf`

Currently still appears in:

- CLI config loading
- extractor-facing types and config semantics
- Vite config resolution

### `@lingui/cli/api`

Currently still appears in:

- Vite `.po` loading path
- Next.js `.po` loading path

The relevant semantics used there are:

- catalog resolution from config
- dependent-file discovery for watch mode
- fallback and source-locale aware translation resolution
- message compilation
- plugin-facing module output

## Target Architecture

### Rust owns

- transform core
- extraction core
- PO parsing
- translation resolution semantics
- message compilation
- plugin-facing compiled catalog result for `.po` imports

### TypeScript owns

- host project config discovery/loading
- Vite adapter
- Next.js adapter
- watch/HMR integration
- CLI UX and filesystem operations

### Boundary rule

Each major operation should cross the native boundary once.

Preferred examples:

- `transformSource(...)`
- `extractMessages(...)`
- `loadCompiledCatalog(...)`

Avoid exposing helper-shaped APIs that force TypeScript to shuttle large intermediate payloads back and forth.

## Workstreams

### 1. Runtime Core

Goal:

- replace the remaining `@lingui/core` dependency with a Palamedes-owned runtime core

Rust:

- own runtime-facing message contracts if they benefit from native consistency

TypeScript:

- keep the runtime package surface ergonomic for application code

Deliverables:

- Palamedes runtime instance type and initialization model
- examples updated to Palamedes-owned runtime setup
- no `@lingui/core` requirement in the primary setup path

### 2. Lean Config Loading

Goal:

- replace `@lingui/conf` with a smaller Palamedes-owned config story

Recommended direction:

- use a lean config discovery library such as `lilconfig`
- keep discovery/loading in TypeScript
- keep config semantics intentionally small and aligned to Palamedes needs

Rust:

- not the home for host-project config discovery

TypeScript:

- discover config
- validate config shape
- translate config into coarse native requests

Deliverables:

- Palamedes config loader
- documented config schema
- CLI and plugins using the same config path

### 3. `.po` Loading and Compilation in Framework Adapters

Goal:

- replace the current `@lingui/cli/api` usage in Vite and Next.js

Important clarification:

- this is not a separate end-user "catalog compiler" product
- it is the internal path used when a framework adapter loads a `.po` file

Rust:

- parse `.po`
- resolve translations with source-locale/fallback semantics
- compile messages
- return plugin-ready compiled output in one coarse operation

TypeScript:

- resolve which catalog file is being requested
- wire watch/HMR
- return the native result to the bundler

Deliverables:

- native `.po` load pipeline for Vite
- native `.po` load pipeline for Next.js
- no `@lingui/cli/api` dependency in plugin codepaths

### 4. Integration Migration

Goal:

- move the surrounding project surface onto the Palamedes-first architecture

Includes:

- CLI updates where needed
- examples
- README and docs updates
- tests and fixtures

Deliverables:

- examples without internal Lingui-owned core/config assumptions
- docs aligned to the Palamedes-first stack
- parity tests at the package boundary

## Implementation Order

Recommended sequence:

1. runtime core direction
2. config loading replacement
3. native `.po` loading/compilation path in Vite and Next.js
4. integration migration across CLI, examples, docs, and tests

Rationale:

- runtime and config define the host-facing contract
- plugin `.po` loading depends on the config model
- examples and docs should move after the new contract is stable

## Testing Strategy

### Runtime

- runtime initialization tests
- server/client lookup behavior tests
- failure mode tests for missing initialization

### Config

- config discovery tests
- schema validation tests
- migration fixture tests from current config shapes where kept

### `.po` Loading

- fixture tests across locales
- fallback/source-locale behavior tests
- missing translation diagnostics
- plugin-level integration tests for Vite and Next.js

### End-to-End

- example app smoke tests
- extraction plus load roundtrip tests
- native boundary regression tests to keep operation count coarse

## Risks

- accidental re-expansion of scope into a full Lingui reimplementation
- TypeScript re-accumulating semantic logic after native calls
- boundary churn caused by helper-shaped native APIs
- migration confusion if examples and docs lag behind the actual architecture

## Success Criteria

- Palamedes owns the remaining internally used Lingui surfaces
- runtime, config, and `.po` loading no longer depend on Lingui-owned packages in core codepaths
- semantic i18n work stays primarily inside Rust
- TypeScript remains a host integration layer
- the solution is lean and directly tied to current Palamedes needs

## Planned GitHub Issues

- replace `@lingui/core` with a Palamedes runtime core
- replace `@lingui/conf` with lean Palamedes config loading
- replace Lingui-based `.po` loading in Vite and Next.js with a native Palamedes pipeline
- migrate CLI, examples, docs, and tests to the Palamedes-first stack
