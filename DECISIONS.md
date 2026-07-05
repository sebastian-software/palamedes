# Palamedes Architecture Decisions

This file indexes the current canonical architecture decisions for Palamedes.
The ADRs themselves live in [`adr/`](./adr/).

The ADR set is intentionally small and present-tense:

- only decisions that still define the current product and implementation model belong here
- historical migration steps, rollout notes, and abandoned intermediate states do not stay in the ADR set
- Git history is the source of truth for chronology; ADRs are the source of truth for the current architecture

## Recommended Reading Order

Read these first:

1. [ADR-001: Project Scope and Positioning](./adr/001-project-scope-and-positioning.md)
2. [ADR-002: Rust-First Core with Thin Host Adapters](./adr/002-rust-first-core-with-thin-host-adapters.md)
3. [ADR-003: Source-String-First Message Identity](./adr/003-source-string-first-message-identity.md)

Then read the core execution model:

4. [ADR-004: Internal Compiled Lookup Keys](./adr/004-internal-compiled-lookup-keys.md)
5. [ADR-005: Universal `getI18n()` Runtime Model](./adr/005-universal-geti18n-runtime-model.md)
6. [ADR-006: Ferrocat as Catalog and ICU Foundation](./adr/006-ferrocat-as-catalog-and-icu-foundation.md)

ADR-006 also records the current Ferrocat integration rule: Palamedes exposes
PO and FCL as product-shaped catalog storage formats, and uses Ferrocat builder
options instead of struct literals at the dependency boundary.

Finally read the host integration decisions:

7. [ADR-007: Native Boundary and Distribution](./adr/007-native-boundary-and-distribution.md)
8. [ADR-008: Framework Adapter Architecture](./adr/008-framework-adapter-architecture.md)
9. [ADR-009: Typed N-API Boundary with Workflow-First Native Operations](./adr/009-typed-napi-boundary-with-workflow-first-native-operations.md)
10. [ADR-010: Generated TypeScript Types Derived from the Native Binding Surface](./adr/010-generated-typescript-types-derived-from-the-native-binding-surface.md)
11. [ADR-011: Host Adapters Render Module Source from Compiled Catalog Artifacts](./adr/011-host-adapters-render-module-source-from-compiled-catalog-artifacts.md)

Then read the product boundary, CLI, and diagnostics decisions:

12. [ADR-012: Translation Augmentation Boundary](./adr/012-translation-augmentation-boundary.md)
13. [ADR-013: Defer CLI Worker Parallelism Until Benchmarked Need](./adr/013-defer-cli-worker-parallelism-until-benchmarked-need.md)
14. [ADR-014: Native Transform Source Maps](./adr/014-native-transform-source-maps.md)
15. [ADR-015: Runtime Formatter Subset Diagnostics](./adr/015-runtime-formatter-subset-diagnostics.md)
16. [ADR-016: Native CLI And YAML-First Configuration](./adr/016-native-cli-and-yaml-first-configuration.md)

## ADR Policy

Each ADR should explain:

- the problem or pressure that made the decision necessary
- the alternatives that were seriously considered
- the decision itself
- the consequences for maintainers and users

If a decision stops being true, replace or remove the ADR instead of keeping stale historical layers around it.
