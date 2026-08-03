# @palamedes/eslint-plugin

Thin ESLint/Oxlint rule facades over Palamedes' native source analysis. The
plugin does not recognize macros or implement authoring rules in JavaScript.

This package is Preview. Oxlint's JavaScript plugin API is still alpha, so
`pmds lint` remains the stable CI and MDX interface.

## Installation

Install the adapter with the host you already use:

```bash
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

The exported `configs.recommended` enables
`no-placeholder-only-message` and `prefer-trans-in-jsx` as warnings.

## Oxlint

```json
{
  "jsPlugins": [
    {
      "name": "palamedes",
      "specifier": "@palamedes/eslint-plugin"
    }
  ],
  "rules": {
    "palamedes/no-placeholder-only-message": "warn",
    "palamedes/prefer-trans-in-jsx": "warn"
  }
}
```

## Rules

| Rule                                        | Default in `configs.recommended` | Purpose                                                                                |
| ------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------- |
| `palamedes/no-placeholder-only-message`     | warning                          | Reject messages made only of runtime values.                                           |
| `palamedes/no-empty-component-only-message` | off                              | Reject a single empty component placeholder; opt in when that policy fits the project. |
| `palamedes/prefer-trans-in-jsx`             | warning                          | Suggest `Trans` for safe direct JSX render positions; `t` remains supported.           |

Each host owns rule severity and its normal inline directives:

```tsx
// eslint-disable-next-line palamedes/no-placeholder-only-message
const eslintLabel = t`${status}`

// oxlint-disable-next-line palamedes/no-placeholder-only-message
const oxlintLabel = t`${status}`
```

The adapter enables every native Core diagnostic in one analysis and caches the
result by filename and source fingerprint. Multiple enabled rule facades do not
repeat native parsing. UTF-8 byte ranges from Rust are converted to the UTF-16
indices expected by JavaScript linters before `SourceCode#getLocFromIndex` maps
them to editor locations.

There are no fixes in this version. `pmds lint` suppressions are intentionally
separate from ESLint/Oxlint directives and are only consumed by the CLI.

MDX is not supported through the adapter because Oxlint JavaScript plugins do
not currently support custom parsers or file formats. Use `pmds lint` for MDX.

The implementation rationale, benchmark, packaging risks, and reproducible LSP
verification are documented in
[Native diagnostics through ESLint and Oxlint](../../docs/research/oxlint-eslint-adapter.md).
