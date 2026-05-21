# ADR-014: Native Transform Source Maps

**Status:** Accepted
**Date:** 2026-05-21

## Context

Palamedes already performs macro transformation in the Rust core. Before this
decision, the Rust transform returned final code plus byte-offset edits, and
`@palamedes/transform` replayed those edits through the JavaScript
`magic-string` package to generate source maps.

That split left the transform workflow divided across two string models:

- Rust and OXC use UTF-8 byte offsets.
- JavaScript strings and JS `magic-string` use UTF-16 code unit indexes.

This boundary caused a real bug when non-ASCII source text appeared before a
later macro edit. The wrapper had to translate native byte offsets into
JavaScript string indexes before source-map generation could work safely.

The split also meant the native transform could produce correct final code
while the JavaScript wrapper still had to reconstruct the edit sequence to
produce a map. That is unnecessary orchestration outside the native workflow.

## Decision

Palamedes generates macro transform source maps in the Rust transform workflow.

The Rust core uses `string_wizard`, Rolldown's Rust-native MagicString-style
editing library, to apply transform edits and generate source maps from the same
UTF-8 byte offsets used by OXC spans.

The native transform result now owns:

- final transformed code
- compiled runtime IDs
- applied byte-offset edits for compatibility and diagnostics
- an optional standard source map for changed modules

Unchanged modules return no source map.

`@palamedes/transform` remains the public JavaScript transform package, but it
no longer replays edits through JS `magic-string`. It forwards the native code
and native source map.

## Alternatives Considered

### 1. Keep JS `magic-string` and convert offsets

Rejected as the long-term architecture. Offset conversion fixes the Unicode bug,
but it keeps source-map generation split across Rust and JavaScript and preserves
an avoidable class of boundary mistakes.

### 2. Return only final code and no source map

Rejected because Vite and Next integrations should preserve source-map support
for transformed application modules.

### 3. Add a separate native source-map helper

Rejected because it would create another native call and still encourage the
host wrapper to orchestrate transform internals. Source-map generation is part
of the transform workflow.

## Consequences

- Transform source-map behavior follows the same UTF-8 byte-offset model as the
  Rust parser and transformer.
- The JavaScript transform wrapper is smaller and no longer depends on
  `magic-string`.
- The N-API transform result has a new optional `map` field.
- `edits` remain in the native result for compatibility, debugging, and future
  tooling, but host packages should not need to replay them for normal
  transform output.
- Transform benchmarks now include native source-map generation as part of the
  native transform path.
