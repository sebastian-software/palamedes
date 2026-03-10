# @lingui/oxc-transform

OXC-based macro transformer for Lingui. Transforms Lingui macros (e.g., `` t`Hello` ``, `<Trans>`, `plural`, `select`) into runtime calls without requiring Babel.

## Features

- 🚀 Fast: Uses [oxc-parser](https://oxc-project.github.io/) for high-performance parsing
- 🔧 No Babel required: Works as a standalone transform
- 📦 Framework agnostic: Can be integrated with any bundler via adapters

## Installation

```bash
pnpm add @lingui/oxc-transform
```

## Usage

```ts
import { transformLinguiMacros } from "@lingui/oxc-transform"

const result = transformLinguiMacros(sourceCode, "filename.tsx", {
  runtimeModule: "@palamedes/runtime",
})

console.log(result.code)
```

## API

### `transformLinguiMacros(code, filename, options?)`

Transforms source code containing Lingui macros into runtime calls.

#### Parameters

- `code` (string): The source code to transform
- `filename` (string): The filename (used for source maps and determining file type)
- `options` (object, optional):
  - `runtimeModule` (string): The module to import `getI18n` from. Default: `"@palamedes/runtime"`

#### Returns

- `{ code: string, hasChanged: boolean, map?: SourceMap | null }`: The transformed code, whether any transformations were made, and an optional source map

## Supported Macros

- `` t`...` `` - Tagged template literal
- `t({ id, message })` - Call expression with message descriptor
- `plural(count, { one: "...", other: "..." })`
- `select(value, { ... })`
- `selectOrdinal(count, { ... })`
- `<Trans>...</Trans>`
- `<Plural>`, `<Select>`, `<SelectOrdinal>`
- legacy `useLingui()` / `getLingui()` compatibility paths

## License

MIT
