# ADR-008: Framework Adapter Architecture

**Status:** Accepted
**Date:** 2026-03-17
**Revised:** 2026-09-11

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
- compiled catalog delivery, module dependency wiring, and integration with
  the host's loading and error boundaries

In the standard framework integration, catalog loading is transparent to
application authors. They author messages through macros and supported
extraction surfaces; the adapter connects the required compiled messages to
the application module graph and ensures they are available before use.
Applications must not need hand-written catalog imports, per-locale loaders,
catalog-specific boundaries, or import-map/manifest HTML plumbing for this
standard path. Locale selection remains application/host policy.

Applications provide their ordinary framework error UI. The adapter propagates
catalog delivery failures to that host error path under ADR-004, without
rendering the affected content with missing messages. The adapter's own loading
mechanism and runtime import paths are implementation concerns, not additional
authoring choices. Low-level APIs for custom integrations are separate from
the standard framework workflow.

Server adapters may load complete compiled catalogs for the request's active
locale; universal server-side module-level splitting is not a v2 requirement.
Server catalogs are loaded on demand by locale, rather than eagerly evaluating
every configured language. Immutable compiled catalog content is reused within
each server process while locale and request-specific runtime state remain
isolated. Request creation must avoid rebuilding complete per-message lookup
structures when it can reference the shared catalog safely. Existing additive
loading, overrides, and development invalidation must remain correct.

ESM module reuse does not guarantee bounded lifetime memory: a long-lived
process can eventually retain every locale it has used, and separate workers
can each hold their own copy. V2 must measure cold loading, warmed reuse,
concurrent requests, and retained memory across locales and workers. External
catalog stores such as Redis are not part of this plan; Redis was raised only
as a comparison for understanding memory ownership.

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

## Implementation status

Next's graph-split client bootstrap already removes application-owned catalog
loading on its opt-in path. Vite import-map delivery still includes manual
manifest and HTML integration in example code, and other examples/adapters
retain manual or serialized catalog paths. The
[active plan](../docs/plans/2026-09-11-compiled-runtime-and-catalog-delivery.md)
tracks convergence on the transparent loading contract.
