# Palamedes Decision Records

These living records describe the current Palamedes v2 model. Read them as a
guide to the product and system, from broad decisions to implementation detail.
They describe the repository contract; the
[release notes](./docs/release-notes-v2.md) distinguish it from published releases.

Numbers express reading order, not the date a decision was made. Git history
preserves earlier versions and the rationale for changes.

## The model at a glance

- [Rust owns shared semantics](./adr/002-rust-first-core-with-thin-host-adapters.md);
  TypeScript adapters connect them to application hosts.
- [Message text and optional context are the public identity](./adr/003-source-string-first-message-identity.md).
  Compiled lookup keys remain internal artifacts.
- [Catalogs compile to executable messages](./adr/004-generated-catalogs-use-executable-message-functions.md),
  and [every public application runtime is parser-free](./adr/005-generated-production-runtime-is-parser-free.md).
- [One `getI18n()` primitive](./adr/006-universal-geti18n-runtime-model.md) resolves
  the active instance: request-local on the server, with a
  [document-fixed locale in the browser](./adr/007-locale-is-fixed-for-a-browser-document.md).
- [The native CLI owns local workflows and data configuration](./adr/012-native-cli-and-yaml-first-configuration.md).
  [Explicit executable plugins](./adr/015-cli-plugin-execution-boundary.md)
  extend it without moving shared semantics into a JavaScript CLI.

The sections below explain the decisions behind this model. Start with the
foundations; use the remaining groups when working on those boundaries.

## Product and system foundations

Start with the product boundary, semantic model, runtime, and shared presentation principles.

1. [ADR-001: Project Scope and Open Positioning](./adr/001-project-scope-and-positioning.md)
2. [ADR-002: Rust-First Core with Thin Host Adapters](./adr/002-rust-first-core-with-thin-host-adapters.md)
3. [ADR-003: Source-String-First Message Identity](./adr/003-source-string-first-message-identity.md)
4. [ADR-004: Generated Catalogs Use Executable Message Functions](./adr/004-generated-catalogs-use-executable-message-functions.md)
5. [ADR-005: Public Application Runtime Is Parser-Free](./adr/005-generated-production-runtime-is-parser-free.md)
6. [ADR-006: Universal `getI18n()` Runtime Model](./adr/006-universal-geti18n-runtime-model.md)
7. [ADR-007: Locale Is Fixed for a Browser Document](./adr/007-locale-is-fixed-for-a-browser-document.md)
8. [ADR-008: Framework Adapter Architecture](./adr/008-framework-adapter-architecture.md)
9. [ADR-009: Ferrocat as Catalog and ICU Foundation](./adr/009-ferrocat-as-catalog-and-icu-foundation.md)
10. [ADR-010: Translation Augmentation Boundary](./adr/010-translation-augmentation-boundary.md)
11. [ADR-011: Editorial Visual Brand System](./adr/011-editorial-visual-brand-system.md)

## Toolchain and distribution

Then read how the native toolchain reaches users and exposes controlled extension points.

12. [ADR-012: Native CLI And YAML-First Configuration](./adr/012-native-cli-and-yaml-first-configuration.md)
13. [ADR-013: Native Boundary and Distribution](./adr/013-native-boundary-and-distribution.md)
14. [ADR-014: The npm Launcher Is A Packaging Bridge With A Node-Free Escape Hatch](./adr/014-npm-launcher-is-a-packaging-bridge.md)
15. [ADR-015: Host Explicit Binary CLI Plugins In Rust](./adr/015-cli-plugin-execution-boundary.md)
16. [ADR-016: Privacy-Bounded CLI Update Checks](./adr/016-privacy-bounded-cli-update-check.md)

## Implementation contracts

These records explain binding, compilation, performance, protocol, and host-specific mechanisms.

17. [ADR-017: Typed N-API Boundary with Workflow-First Native Operations](./adr/017-typed-napi-boundary-with-workflow-first-native-operations.md)
18. [ADR-018: Generated TypeScript Types Derived from the Native Binding Surface](./adr/018-generated-typescript-types-derived-from-the-native-binding-surface.md)
19. [ADR-019: Native Catalog Rendering Produces Bundler Modules](./adr/019-native-catalog-rendering-produces-bundler-modules.md)
20. [ADR-020: Internal Compiled Lookup Keys](./adr/020-internal-compiled-lookup-keys.md)
21. [ADR-021: Runtime Formatter Subset Diagnostics](./adr/021-runtime-formatter-subset-diagnostics.md)
22. [ADR-022: Extraction Cache](./adr/022-extraction-cache.md)
23. [ADR-023: Bounded Parallel Extraction](./adr/023-bounded-parallel-extraction.md)
24. [ADR-024: Native Transform Source Maps](./adr/024-native-transform-source-maps.md)
25. [ADR-025: Binary Plugin Protocol For Rust-Hosted Extensions](./adr/025-binary-plugin-protocol.md)
26. [ADR-026: React Router RSC Entry Request Scope](./adr/026-react-router-rsc-entry-request-scope.md)

## Website and project operation

Read these when changing shared documentation surfaces or the repository workflow.

27. [ADR-027: Shared Cross-Repository Site UI](./adr/027-shared-cross-repository-site-ui.md)
28. [ADR-028: README Theme Composition](./adr/028-readme-theme-composition.md)
29. [ADR-029: Effective Flow Project Setup](./adr/029-effective-flow-project-setup.md)

## Maintaining living decisions

Palamedes deliberately uses a living variant of ADRs. The
[classic convention](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
keeps accepted decisions as historical records with stable numbers and links
to successors when a decision changes. Here, each file describes the current
decision and may be revised in place; numbers organize the reading sequence.
Contributors and coding agents can read the current contract directly without
resolving successor chains or combining conflicting historical instructions.
Each current record still explains its context, alternatives, and consequences.
The tradeoff is that earlier decisions and their chronology require Git history
rather than a self-contained supersession log.

- Keep each record focused on one significant decision and its rationale.
  There is no target document count. A choice deserves a separate record when
  it has meaningful alternatives and durable consequences that future
  contributors need to understand.
- Related decisions may remain separate when they can change independently.
  For example, executable catalog functions do not by themselves guarantee
  parser-free package entrypoints. Merge records when they explain the same
  choice; move API inventories, procedures, and experiment detail to their
  owning documentation rather than expanding the decision log.
- Update an existing record when its decision evolves. Keep the current
  contract clear instead of appending amendments or supersession chains.
- Use `Status: Accepted` for the current corpus and `Last updated: YYYY-MM-DD`
  for semantic revisions. A proposed decision must be identified as proposed
  until it is adopted. Git carries chronology rather than dated rollout notes.
- Begin each record with a short summary and its decision. Explain the context,
  meaningful alternatives, consequences, and verification or review triggers
  needed to understand it. Avoid task logs, obsolete API inventories, and
  experimental measurements that belong in reports.
- Keep exact executable values in code or configuration. The sole configuration
  exception is [the project setup record](./adr/029-effective-flow-project-setup.md),
  which owns the tracked Effective Flow settings as one cohesive table.
- Keep one canonical record per current decision. Remove abandoned intermediate
  states and link to migration guides, issue tracking, or benchmark evidence
  when readers need those distinct artifacts.
- Place new decisions by scope and dependency. Renumber only when the reading
  structure changes, update repository references together, and retain old
  public URLs through `site/decision-redirects.json`. Retired URLs must point
  directly to the current record, without redirect chains.

Run `pnpm check:decisions` and `pnpm check:llms` after changing the corpus. The
website uses this same index for its reading guide and derives its sidebar from
the numbered source files.
