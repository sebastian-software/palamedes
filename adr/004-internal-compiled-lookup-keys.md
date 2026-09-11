# ADR-004: Internal Compiled Lookup Keys

**Status:** Accepted
**Date:** 2026-03-17
**Revised:** 2026-09-11

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

A missing translation is resolved during catalog compilation through the
configured fallback locales and ultimately the source message. That fallback
is compiled like a translation; `failOnMissing` can require a translation in
the target locale instead. This compiled translation fallback remains valid;
it is not recovery from a failed runtime catalog load.

A failed catalog or fragment load, or an unexpected missing compiled entry,
must not render an internal key, raw ICU pattern, or substitute source text in
the affected application output. Such failures propagate to the host's error
handling. UI integrations must prevent the affected subtree or route from
rendering incomplete localized content and use the appropriate error boundary
or host equivalent. Server execution must report failure rather than return a
partially localized result as success.

Internal keys may appear in developer diagnostics, never as user-facing
message output or raw error UI. Any retained source metadata is for diagnostics,
not an alternate runtime rendering path. The legacy `keepSourceFallbacks`
spelling is retained only as an explicit diagnostic-metadata opt-in; v2
first-party adapters default to `false`.

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
- Runtime catalog failures reach host error handling; the affected application
  content is not rendered using source text or internal keys. Build-time
  translation fallbacks are ordinary compiled messages and remain supported.
- Documentation must describe the keys as implementation detail, not as product identity.
- The runtime key contract can be shared cleanly between transformed code and compiled catalog artifacts without turning those keys into a public authoring concept.

## Implementation status

Core package roots and compiled aliases now reject missing compiled entries.
Source metadata is diagnostic information only, and telemetry cannot suppress
lookup or execution failures. Low-level transforms and v2 first-party host
adapters generate compact runtime calls without embedding the authored source
message by default. Set `keepSourceFallbacks: true` only when authored source
text is needed as diagnostic metadata; `false` is the default and produces
compact, hash-only output. This legacy option name never implies a runtime
fallback mode.

Transparent host delivery and initial/hydration/navigation error recovery are
tracked in the dependent integration slices of #1204. An import rejection by
itself does not establish a usable host error boundary. The coordinated v2
release remains held until those paths and migration proofs are complete.
