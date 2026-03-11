# ADR-014: Universal `getI18n()` Runtime Primitive

**Status:** Accepted
**Date:** 2026-03-10

### Context

Palamedes currently carries two separate macro-facing access patterns:

- a React-oriented accessor style
- a direct runtime accessor style

That split was intended to distinguish hook-like usage from server-safe usage, but it creates an unclear mental model:

- users have to decide between two APIs for the same translation work
- the React-oriented accessor looks like a normal hook, even when macro expansion is the real mechanism
- Server Components become harder to reason about because it is not obvious which API is valid where
- the transform has to special-case multiple runtime targets for equivalent operations

At the same time, Palamedes is moving toward owning the macro and runtime contract directly instead of adapting Lingui's existing assumptions. In that model, the important primitive is not "hook vs non-hook", but "resolve the currently active i18n instance correctly for this environment".

### Decision

Adopt a single public runtime primitive: `getI18n()`.

Target model:

- translation macros compile against `getI18n()`
- runtime consumers may call `getI18n()` directly for data such as `getI18n().locale`
- separate client/server accessors are no longer part of the preferred long-term API model

`getI18n()` semantics:

- on the client, return the initialized active client-side instance
- on the server, return the active request-local instance
- if no active instance exists, throw immediately

No silent fallback is allowed. Returning a wrong locale for part of the app is considered a correctness bug and must fail loudly.

### Rationale

- one mental model across client and server
- no hook-shaped API for a concept that is fundamentally runtime lookup
- simpler macro transform output
- clearer ownership boundary for a Palamedes-native runtime
- safer behavior under server concurrency because missing initialization becomes explicit

### Consequences

- runtime and transform layers should converge on `getI18n()`-based code generation
- React integration becomes an adapter concern, not the core i18n access pattern
- server initialization must provide a request-local i18n instance before translated code executes
- error messages from `getI18n()` must be explicit about missing client initialization or missing server request context

### Follow-Up

- remove old accessor terminology from docs and examples
- update transform output to target `getI18n()`
- define the concrete runtime package surface for `getI18n()` and initialization helpers
