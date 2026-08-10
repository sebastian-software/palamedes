# `@palamedes/eslint-plugin`

`@palamedes/eslint-plugin` surfaces Palamedes' native source diagnostics inside
ESLint and Oxlint. The rules are thin facades: the plugin does not re-implement
macro analysis in JavaScript, it forwards one native Core analysis per file.

This package is Preview. Oxlint's JavaScript plugin API is still alpha, so
[`pmds lint`](../cli.md#lint) remains the stable CI and MDX interface.

## Installation

```sh
pnpm add -D @palamedes/eslint-plugin eslint
# or
pnpm add -D @palamedes/eslint-plugin oxlint
```

Keep optional dependencies enabled so `@palamedes/core-node` can install the
native package for the current platform.

## ESLint flat config

```js
import palamedes from "@palamedes/eslint-plugin"

export default [
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    plugins: { palamedes },
    rules: {
      "palamedes/no-placeholder-only-message": "warn",
      "palamedes/prefer-trans-in-jsx": "warn",
    },
  },
]
```

`configs.recommended` enables `no-placeholder-only-message` and
`prefer-trans-in-jsx` as warnings.

## Oxlint

```json
{
  "jsPlugins": [{ "name": "palamedes", "specifier": "@palamedes/eslint-plugin" }],
  "rules": {
    "palamedes/no-placeholder-only-message": "warn",
    "palamedes/prefer-trans-in-jsx": "warn"
  }
}
```

## Rules

| Rule                                        | In `configs.recommended` | Purpose                                                                                |
| ------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------- |
| `palamedes/no-placeholder-only-message`     | warning                  | Reject messages made only of runtime values.                                           |
| `palamedes/no-empty-component-only-message` | off                      | Reject a single empty component placeholder; opt in when that policy fits the project. |
| `palamedes/prefer-trans-in-jsx`             | warning                  | Suggest `Trans` for safe direct JSX render positions; `t` remains supported.           |

There are no autofixes in this version. Each host owns rule severity.

## Suppressions differ from the CLI

The adapter leaves suppression handling to its host, so findings are silenced
with the host's own directive:

```tsx
// eslint-disable-next-line palamedes/no-placeholder-only-message
const eslintLabel = t`${status}`

// oxlint-disable-next-line palamedes/no-placeholder-only-message
const oxlintLabel = t`${status}`
```

`pmds lint` does not read those directives, and this plugin does not read
`palamedes-lint-disable-*`. A project running both lanes needs the directive
each lane understands, and the rule names differ as well: the CLI reports the
native diagnostic codes (`pmds/no-placeholder-only-message`), while the plugin
exposes the same diagnostic under its host plugin namespace
(`palamedes/no-placeholder-only-message`). See
[the CLI suppression reference](../cli.md#lint) for the `pmds lint` side.

## Coverage and limits

- **One analysis per file.** Every native diagnostic is enabled in a single
  analysis, cached by filename and source fingerprint, so several enabled
  facades never repeat native parsing. UTF-8 byte ranges from Rust are converted
  to UTF-16 indices before the host maps them to editor locations.
- **Native failures are reported once per host parse.** ESLint-compatible hosts
  require a diagnostic to come from an enabled rule, so the reported `ruleId` is
  the first enabled Palamedes facade; the message states that it is a shared
  native-analysis failure rather than a finding from that rule. A later editor
  re-parse reports it again; an unchanged parse does not duplicate it.
- **MDX is not supported here.** Oxlint JavaScript plugins cannot register
  custom parsers or file formats. Use `pmds lint` for MDX.

The implementation rationale, benchmark, packaging risks, and reproducible LSP
verification live in
[Native diagnostics through ESLint and Oxlint](../research/oxlint-eslint-adapter.md).
