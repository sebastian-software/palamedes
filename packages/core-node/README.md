# @palamedes/core-node

[![npm version](https://img.shields.io/npm/v/%40palamedes%2Fcore-node?logo=npm)](https://www.npmjs.com/package/@palamedes/core-node)
[![CI](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml)
[![Sponsored by Sebastian Software](https://img.shields.io/badge/Sponsored%20by-Sebastian%20Software-0f172a.svg)](https://oss.sebastian-software.com/)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f172a.svg)](https://github.com/sebastian-software/palamedes/blob/main/LICENSE)

The Node.js wrapper around Palamedes' native core.

Use this package when you are building tooling on top of Palamedes and want direct access to native message ID generation, `.po` parsing, extraction, or macro transformation.

## When To Use This Package

Reach for `@palamedes/core-node` when you are:

- building custom tooling around Palamedes
- integrating the native transform or extractor outside the first-party plugins
- working on Palamedes internals

If you are integrating Palamedes into an app, you usually want one of these instead:

- [`@palamedes/vite-plugin`](https://www.npmjs.com/package/@palamedes/vite-plugin)
- [`@palamedes/next-plugin`](https://www.npmjs.com/package/@palamedes/next-plugin)
- [`@palamedes/cli`](https://www.npmjs.com/package/@palamedes/cli)

## Installation

```bash
pnpm add @palamedes/core-node
```

The package loads one of these platform packages behind the scenes:

- `@palamedes/core-node-darwin-arm64`
- `@palamedes/core-node-linux-x64-gnu`
- `@palamedes/core-node-linux-arm64-gnu`
- `@palamedes/core-node-win32-x64-msvc`

## Example

```ts
import { getNativeInfo, parsePo, generateMessageId } from "@palamedes/core-node"

const info = getNativeInfo()
const id = generateMessageId("Hello {name}")
const po = parsePo(`
msgid ""
msgstr ""
"Language: en\\n"
`)

console.log(info.palamedesVersion)
console.log(id)
console.log(po.headers.Language)
```

## Available APIs

- `getNativeInfo()`
- `generateMessageId(message, context?)`
- `parsePo(source)`
- `extractMessagesNative(source, filename)`
- `transformMacrosNative(source, filename, options?)`

## Related Packages

- [`@palamedes/transform`](https://www.npmjs.com/package/@palamedes/transform)
- [`@palamedes/extractor`](https://www.npmjs.com/package/@palamedes/extractor)
- [`@palamedes/vite-plugin`](https://www.npmjs.com/package/@palamedes/vite-plugin)
- [`@palamedes/next-plugin`](https://www.npmjs.com/package/@palamedes/next-plugin)

## License

[![Sebastian Software](https://sebastian-brand.vercel.app/sebastian-software/logo-software.svg)](https://oss.sebastian-software.com/)

MIT © 2026 Sebastian Software
