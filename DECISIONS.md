# Palamedes Architecture Decisions

This directory contains the current canonical architecture decisions for Palamedes.

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

Finally read the host integration decisions:

7. [ADR-007: Native Boundary and Distribution](./adr/007-native-boundary-and-distribution.md)
8. [ADR-008: Framework Adapter Architecture](./adr/008-framework-adapter-architecture.md)
9. [ADR-009: Typed N-API Boundary with Workflow-First Native Operations](./adr/009-typed-napi-boundary-with-workflow-first-native-operations.md)

## ADR Policy

Each ADR should explain:

- the problem or pressure that made the decision necessary
- the alternatives that were seriously considered
- the decision itself
- the consequences for maintainers and users

If a decision stops being true, replace or remove the ADR instead of keeping stale historical layers around it.
