# ADR-013: Hybrid Native Extractor Rollout

**Status:** Accepted
**Date:** 2026-03-09

### Context

The Palamedes extractor is moving from a TypeScript implementation to a Rust-core implementation.

A full one-shot port would combine several concerns at once:

- OXC parser migration to Rust
- macro import tracking
- runtime call extraction
- JSX message extraction
- choice macro handling such as `plural`, `select`, and `selectOrdinal`

That would make the first extractor slice harder to validate and harder to land incrementally.

### Decision

Roll out the extractor in hybrid mode.

Phase-1 native coverage includes:

- tagged template extraction for `t` and `msg`
- descriptor-style extraction for `t({...})`, `defineMessage({...})`, and `msg({...})`
- runtime extraction for `i18n._(...)` and `i18n.t\`...\``
- `useLingui()` destructured `t` bindings

The TypeScript extractor remains as a fallback for:

- JSX macros such as `<Trans>`, `<Plural>`, and `<Select>`
- choice macros such as `plural()`, `select()`, and `selectOrdinal()`
- any case where the native extractor throws during the transition

### Consequences

- Palamedes gains a real production path through the Rust extractor immediately.
- Existing behavior remains stable while JSX and choice macro coverage are still being ported.
- The fallback boundary is explicit and testable, instead of being spread across ad hoc conditionals later.
- A follow-up slice should reduce and eventually remove the TypeScript fallback surface.
