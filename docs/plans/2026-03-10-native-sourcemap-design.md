# Native Transform Sourcemap Design

## Goal

Make source maps an always-on part of the Palamedes transform result and remove the legacy JavaScript transform path.

## Approved API Shape

- Remove `sourceMap` from `TransformOptions`
- Always return a source map when code changed
- Return `map: null` only when the input was left unchanged

## Recommended Implementation

- Keep the Rust transform as the single source of truth for macro rewrites
- Extend the native result with edit metadata and optional prepended import text
- Rebuild code and source maps in the TypeScript wrapper by replaying native edits with `MagicString`
- Delete the old JavaScript AST transform instead of keeping two transform implementations alive

## Why This Shape

- It removes duplicate transform semantics from TypeScript
- It avoids implementing VLQ source-map encoding from scratch in Rust
- It keeps source-map generation deterministic and easy to validate
- It leaves the native transform focused on parsing and rewrite decisions

## Validation

- `cargo test --workspace`
- `pnpm --filter @palamedes/core-node build`
- `pnpm test`
- `pnpm check-types`
