# ADR-001: Project Scope and Positioning

**Status:** Accepted
**Date:** 2026-03-17

## Context

Palamedes is still early. That is an advantage if the project stays disciplined about what it is and what it is not.

Many i18n libraries in the JavaScript ecosystem grew under different constraints:

- broad backward compatibility
- support for many historical API styles
- multiple overlapping runtime models
- a mix of build-time and runtime concerns spread across many packages

Those trade-offs are understandable for mature ecosystems, but they are not a good default for Palamedes.

Palamedes needs a scope that is opinionated enough to keep the architecture coherent. Without that, the project would drift into becoming either:

- a thin compatibility wrapper around older Lingui assumptions
- a broad general-purpose application i18n framework in the style of route- and middleware-heavy solutions
- a repository that keeps every intermediate migration idea alive

None of those outcomes are desirable.

## Decision

Palamedes is an opinionated i18n toolkit for modern JavaScript and TypeScript applications with a native core and thin host adapters.

Its focus is:

- build-time message extraction and transformation
- gettext-compatible source-string-first catalogs
- a small runtime contract for transformed code
- first-party framework adapters for supported hosts

Palamedes is explicitly not:

- a compatibility-first reimplementation of Lingui
- a route-centric application framework for locale negotiation and page-level routing
- a general-purpose replacement for every i18n concern an application may have
- a project that keeps historical migration stages as part of its canonical architecture

Where Palamedes intentionally differs from Lingui-like systems:

- the architecture is allowed to be more opinionated
- explicit author-facing message IDs are not part of the intended model
- the native core is the default home for semantic i18n logic
- historical compatibility is subordinate to clarity of the end state

Where Palamedes intentionally differs from next-intl-like systems:

- the primary abstraction is not route-first locale management
- the center of gravity is compile-time transformation plus catalogs, not runtime-only formatting APIs
- framework adapters exist to integrate the core, not to define the domain model

## Alternatives Considered

### 1. Broad compatibility-first scope

This would preserve more old API shapes and migration paths.

Rejected because it would lock Palamedes into carrying legacy architectural constraints before the project has even stabilized.

### 2. Framework-first product scope

This would make Vite or Next.js integration the defining center of the architecture.

Rejected because framework APIs are host-specific and should not define the core i18n model.

### 3. Fully general i18n platform

This would expand into every part of locale handling, formatting, routing, negotiation, and application state.

Rejected because Palamedes is strongest when it owns the build-time and catalog path deeply instead of spreading into adjacent concerns too early.

## Consequences

- New features should be evaluated against the opinionated product scope, not against compatibility pressure alone.
- Decisions that simplify the final architecture are preferred over decisions that preserve historical API variety.
- Framework adapters and tooling packages must stay aligned with the core model instead of growing separate local semantics.
- The ADR set should stay small and current. If a decision no longer defines the present architecture, it should be replaced rather than preserved as ballast.
