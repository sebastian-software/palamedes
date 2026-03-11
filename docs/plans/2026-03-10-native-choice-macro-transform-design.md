# Native Choice Macro Transform Design

## Goal

Extend the Rust transform path to handle direct choice macros:

- `plural(...)`
- `select(...)`
- `selectOrdinal(...)`

At the same time, remove the old accessor-style transform paths instead of keeping them as compatibility behavior.

## Approved Scope

- Add native Rust transform support for direct choice macro calls
- Keep JSX and sourcemap handling on the JS fallback path
- Remove legacy accessor transform support from the TypeScript implementation
- Remove transform tests for legacy accessor paths
- Do not add compatibility guards or special migration errors

## Implementation Shape

- Rust core:
  - parse direct choice macro calls from imported macro bindings
  - convert options objects to ICU message strings
  - emit `getI18n()._({ ... })` descriptors with generated IDs and `values`
- TS wrapper:
  - stop treating `plural` / `select` / `selectOrdinal` as native-unsupported
  - keep JSX as the primary fallback trigger while sourcemaps remain JS-only
- TS transform:
  - remove legacy accessor destructuring support
  - preserve unchanged output when no supported transform replacements are produced

## Validation

- `cargo test --workspace`
- `pnpm test`
- `pnpm check-types`
- direct tests that exercise native choice macro transforms
