# ADR-005: Internal Lookup Key Generation

**Status:** Superseded
**Date:** 2025-12

### Context

Palamedes originally documented generated message IDs as if they were part of the product-level message model.

That turned out to be the wrong abstraction. Conceptually, Palamedes follows the Lingui/Gettext model:

- `msgid` is the source string
- `msgctxt` disambiguates when needed
- together they define message identity

### Decision

Generated short hashes derived from `message + context` remain allowed only as an internal compile/runtime lookup key.

They are:

- not part of the public authoring model
- not exposed as a first-class API in `@palamedes/core-node`
- not the conceptual identity used by extraction or catalog updates

### Consequences

- source strings and optional context are the only public message identity model
- explicit author-facing `id` flows are not part of the intended Palamedes design
- generated lookup hashes may still appear in transformed output where compact runtime lookup is useful

