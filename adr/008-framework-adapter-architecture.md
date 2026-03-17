# ADR-008: Framework Adapter Architecture

**Status:** Accepted
**Date:** 2026-03-17

## Context

Palamedes needs to integrate with framework and bundler ecosystems such as Vite and Next.js.

Those integrations are necessary, but they should not become the place where Palamedes redefines its message model, catalog semantics, or runtime contract.

Without a strict adapter model, framework packages tend to accumulate:

- local parsing behavior
- duplicated catalog logic
- custom diagnostics models
- framework-specific versions of the same core semantics

That creates a maintenance problem and makes the architecture harder to reason about for new contributors.

## Decision

Framework integrations in Palamedes are adapters over the core, not alternate semantic implementations.

Framework adapters may own:

- host-specific config loading
- bundler/plugin hooks
- file watching and invalidation
- resource-path resolution tied to the host
- HMR and build-pipeline orchestration

Framework adapters must not become the primary home for:

- message identity rules
- transform semantics
- catalog update semantics
- parsed catalog semantics
- runtime contract design

The adapter principle also applies to future hosts: adding support for another host should reuse the same core semantics rather than defining a new local i18n model.

## Alternatives Considered

### 1. Framework packages as product centers

Rejected because it would let Vite or Next.js specifics reshape the core architecture.

### 2. One giant general-purpose integration package

Rejected because different hosts still need different orchestration code, even if they share semantics.

### 3. Rebuild host-specific semantic pipelines

Rejected because it would reintroduce duplicated catalog and transform logic outside the native core.

## Consequences

- Vite and Next.js integrations should stay thin even when they need non-trivial orchestration.
- Core semantic changes should usually land in Rust or in shared package surfaces, not first in adapters.
- Documentation for supported hosts should explain the adapter contract clearly: adapters connect the host to Palamedes, they do not redefine Palamedes.
- Palamedes stays portable across hosts because the core model remains independent of any single integration surface.
