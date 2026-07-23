# @palamedes/extractor

[![npm version](https://img.shields.io/npm/v/%40palamedes%2Fextractor?logo=npm)](https://www.npmjs.com/package/@palamedes/extractor)
[![CI](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml)
[![Sponsored by Sebastian Software](https://img.shields.io/badge/Sponsored%20by-Sebastian%20Software-0f172a.svg)](https://oss.sebastian-software.com/)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f172a.svg)](https://github.com/sebastian-software/palamedes/blob/main/LICENSE)

Fast message extraction for teams that want a lower-level API alongside the CLI.

`@palamedes/extractor` uses Palamedes' native core first to pull messages out of
JavaScript, TypeScript, and React codebases without sending the workflow through
a Babel-heavy path.

## When To Use This Package

Use `@palamedes/extractor` when you want:

- direct control over extraction in your own scripts or tools
- a lower-level extractor for custom workflows
- the same extraction engine that powers the Palamedes CLI

If you just want the supported command-line workflow, use [`@palamedes/cli`](https://www.npmjs.com/package/@palamedes/cli).

## Installation

```bash
pnpm add -D @palamedes/extractor
```

## Minimal Example

```ts
import { extractor } from "@palamedes/extractor"

const source =
  'import { t } from "@palamedes/core/macro"; function message(name) { return t`Hello ${name}` }'
const messages = []

await extractor.extract("example.ts", source, (message) => {
  messages.push(message)
})

console.log(messages)
```

## Supported Inputs

- `t`, `plural`, `select`, `selectOrdinal`
- `<Trans>`, `<Plural>`, `<Select>`, `<SelectOrdinal>`
- `i18n._(...)` and `i18n.t\`...\`` style runtime calls
- JavaScript, TypeScript, JSX, and TSX sources

The extractor rejects eager `t`, `plural`, `select`, and `selectOrdinal`
macros, plus `<Plural>`, `<Select>`, and `<SelectOrdinal>`, when they appear
outside a function, method, or callback. `<Trans>` is safe at module scope
because translation occurs during component rendering. Class field initializers
do not count as function scope; use a method or getter instead.

Rich JSX children inside `<Trans>` are extracted with numeric component slots. For example,
`<Trans><strong>A</strong> and <strong>B</strong></Trans>` extracts as
`<0>A</0> and <1>B</1>`.

## Key Exports

- `extractor`
- `extractMessages(source, filename)`
- `ExtractedMessageInfo`

## Related Packages

- [`@palamedes/cli`](https://www.npmjs.com/package/@palamedes/cli)
- [`@palamedes/transform`](https://www.npmjs.com/package/@palamedes/transform)
- [`@palamedes/core-node`](https://www.npmjs.com/package/@palamedes/core-node)

## Limitations

The extractor currently does not support `lingui-extract-ignore` comments.

## License

[![Sebastian Software](https://sebastian-brand.vercel.app/sebastian-software/logo-software.svg)](https://oss.sebastian-software.com/)

MIT © 2026 Sebastian Software
