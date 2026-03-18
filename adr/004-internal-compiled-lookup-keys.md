# ADR-004: Internal Compiled Lookup Keys

**Status:** Accepted
**Date:** 2026-03-17

## Context

Even in a source-string-first system, the runtime representation does not need to use raw source strings as lookup keys.

There are practical reasons to derive a compact lookup key during compilation:

- smaller runtime payloads
- stable compact object keys
- easier stripping of source text from transformed output when desired
- compatibility with runtime maps generated from compiled catalogs

The risk is that these derived keys start leaking into the public message model and become mistaken for the true identity of a message.

Palamedes needs both of these statements to be true at the same time:

- the public model is source-string-first
- the runtime is allowed to use compact compiled lookup keys

## Decision

Palamedes may derive a stable compact lookup key from `message + context`, but only as an internal compile/runtime artifact.

This key:

- is allowed in transformed output
- is allowed in compiled catalog maps
- must be stable for a given `message + context`
- is not the conceptual message identity
- is not an author-facing API concept

The derivation strategy is fixed and not a configurable application-level feature. Palamedes follows Ferrocat's public `FerrocatV1` compiled-key contract for this purpose rather than owning a separate private algorithm.

Source code, extraction, catalog updates, parsed catalog data, and user-facing diagnostics remain source-string-first.

## Alternatives Considered

### 1. Use raw source strings as runtime lookup keys

Rejected because it inflates runtime payloads and makes compiled output less compact.

### 2. Expose generated IDs as a first-class public concept

Rejected because it would collapse the distinction between conceptual identity and compiled representation.

### 3. Let users choose the key strategy

Rejected because it adds policy surface where Palamedes benefits from a single coherent model.

## Consequences

- Palamedes can keep runtime payloads compact without reintroducing an author-facing ID model.
- Transformed code and compiled catalogs may contain opaque short keys without changing the public authoring contract.
- Documentation must describe the keys as implementation detail, not as product identity.
- The runtime key contract can be shared cleanly between transformed code and compiled catalog artifacts without turning those keys into a public authoring concept.
