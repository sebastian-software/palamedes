# Native JSX Transform Design

## Goal

Extend the Rust transform path to cover JSX Lingui macros:

- `<Trans>`
- `<Plural>`
- `<Select>`
- `<SelectOrdinal>`

## Approved Shape

- Keep `<Trans>` as a component transform to `<Trans ... />`
- Keep choice JSX macros as runtime call transforms via `getI18n()._({ ... })`
- Remove JSX from the native-unsupported wrapper patterns
- Leave the TypeScript fallback primarily for sourcemap generation

## Implementation Notes

- Reuse JSX parsing helpers from the native extractor for attributes, value lookup, and choice options
- Add native JSX replacements in `visit_jsx_element`
- Insert `import { Trans } from "@lingui/react"` only when the native `<Trans>` path is used
- Continue removing macro imports after native replacements are produced

## Validation

- `cargo test --workspace`
- `pnpm --filter @palamedes/core-node build`
- `pnpm test`
- `pnpm check-types`
- direct native probe for `<Trans>` via `transformMacrosNative(...)`
