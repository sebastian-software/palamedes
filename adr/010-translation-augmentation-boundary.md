# ADR-010: Translation Augmentation Boundary

**Status:** Accepted

**Last updated:** 2026-10-16

Local translation workflow primitives belong in the open-source core; remote providers and account policy stay outside it.

## Decision

Palamedes should own host-neutral translation workflow primitives when they are local semantic concerns.

The boundary admits local primitives such as:

- PO entry selection and delta targeting
- context packaging inputs from catalogs and source metadata
- glossary and protected-term loading and matching
- deterministic QA issue generation
- PO metadata parser/formatter/hash helpers
- report data structures
- bounded orchestration helpers that are not account- or provider-specific

Palamedes should not own:

- remote model execution
- provider routing
- account or entitlement logic
- billing, usage enforcement, or product-specific policy packs

Those remain valid concerns for Palamedes+ or other higher-order products.

## Context

Palamedes supplies a complete local translation workflow. Managed products can
reuse that workflow without moving provider or account policy into the core.

That creates a new architectural question:

- which translation workflow capabilities belong in Palamedes Core as reusable local substrate
- which capabilities should remain outside Core because they are product-specific or account-bound

If Palamedes stops too early, higher-order translation workflows will rebuild repo, catalog, QA, and metadata semantics elsewhere. If it absorbs too much, it risks turning the OSS core into a hosted translation product in disguise.

## Consequences

- Translation-support code in Palamedes is justified when it removes duplicated local semantics across products.
- The Core/Plus split remains commercially meaningful because the managed engine stays outside Core.
- Future workflow work should first ask whether the concern is local semantic substrate or remote/account-bound product behavior.
