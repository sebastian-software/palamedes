# ADR-024: Native Transform Source Maps

**Status:** Accepted

**Last updated:** 2026-10-16

The native transform produces code and source maps from the same UTF-8 edit model.

## Decision

Palamedes generates macro transform source maps in the Rust transform workflow.

The Rust core uses `string_wizard`, Rolldown's Rust-native MagicString-style
editing library, to apply transform edits and generate source maps from the same
UTF-8 byte offsets used by OXC spans.

The native transform result owns:

- final transformed code
- compiled runtime IDs
- applied byte-offset edits for compatibility and diagnostics
- an optional standard source map for changed modules

Unchanged modules return no source map.

`@palamedes/transform` remains the public JavaScript transform package, but it
does not replay edits through JS `magic-string`. It forwards the native code
and native source map.

## Context

Macro transformation and source maps must describe the same edits. Splitting
code generation from map generation creates two offset models and duplicates
the transform workflow.

The two ecosystems use different string indexes:

- Rust and OXC use UTF-8 byte offsets.
- JavaScript strings and JS `magic-string` use UTF-16 code unit indexes.

Non-ASCII text before an edit makes those offsets diverge. Generating the
code and map together avoids conversion mistakes and a second edit replay.

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
- The N-API transform result has an optional `map` field.
- `edits` remain in the native result for compatibility, debugging, and future
  tooling, but host packages should not need to replay them for normal
  transform output.
- Transform benchmarks include native source-map generation as part of the
  native transform path.
