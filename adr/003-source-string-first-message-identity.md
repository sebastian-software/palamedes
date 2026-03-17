# ADR-003: Source-String-First Message Identity

**Status:** Accepted
**Date:** 2026-03-17

## Context

There are multiple ways to model message identity in i18n systems.

One model uses explicit product-defined IDs such as:

```ts
{ id: "checkout.cta", message: "Buy now" }
```

Another model follows the gettext tradition:

- `msgid` is the source string
- `msgctxt` optionally disambiguates the source string
- together they define identity

Palamedes is deliberately closer to the second model.

That matters because identity affects almost every major surface:

- extraction
- diagnostics
- catalog updates
- catalog parsing
- transform semantics
- migration guidance

If Palamedes treats source strings as the conceptual model but still preserves author-facing explicit IDs as a parallel first-class path, the architecture becomes internally contradictory.

## Decision

Palamedes is source-string-first.

The only conceptual message identity is:

- `message`
- plus optional `context`

In gettext terms, that means:

- `msgid`
- plus optional `msgctxt`

Explicit author-facing message IDs are not part of the Palamedes model.

This applies across the product surface:

- extraction results
- catalog update requests
- parsed catalog views
- diagnostics
- user-facing documentation

When users author messages, Palamedes expects message text and optional context, not a separate stable product key.

If author-facing explicit IDs are encountered in supported inputs, Palamedes should reject them clearly rather than silently preserving a second identity model.

## Alternatives Considered

### 1. Support both source-string-first and explicit-ID-first equally

Rejected because it makes the architecture and documentation harder to reason about and reintroduces the split model Palamedes is trying to remove.

### 2. Prefer explicit IDs

Rejected because it moves Palamedes away from the gettext/Lingui mental model and creates authoring overhead that does not scale well.

### 3. Keep explicit IDs only as a soft compatibility path

Rejected because "soft" compatibility paths tend to become permanent architecture and prevent the model from becoming clear.

## Consequences

- Source strings and optional context are the only public identity model.
- Catalog behavior, diagnostics, and migration guidance should describe messages in source-first terms.
- Internally generated keys may still exist for compiled lookup, but they must not be treated as the conceptual identity.
- Palamedes stays close to the strongest part of the gettext and Lingui model while remaining more opinionated about removing explicit-ID sprawl.
