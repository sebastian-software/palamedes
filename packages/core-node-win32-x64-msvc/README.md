# @palamedes/core-node-win32-x64-msvc

[![npm version](https://img.shields.io/npm/v/%40palamedes%2Fcore-node-win32-x64-msvc?logo=npm)](https://www.npmjs.com/package/@palamedes/core-node-win32-x64-msvc)
[![CI](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f172a.svg)](https://github.com/sebastian-software/palamedes/blob/main/LICENSE)

Platform-specific native bindings for `@palamedes/core-node` on Windows x64 with MSVC.

## When To Use This Package

You usually should not install this package directly.

`@palamedes/core-node` pulls in the matching native package for the current environment. This package exists so the Windows binary can ship as a normal npm artifact instead of through a custom installer story.

## Installation

Install [`@palamedes/core-node`](https://www.npmjs.com/package/@palamedes/core-node) instead:

```bash
pnpm add @palamedes/core-node
```

## Package Role

- contains the `.node` binary for `win32-x64-msvc`
- is loaded internally by `@palamedes/core-node`
- is not intended as a stable direct dependency

## Related Packages

- [`@palamedes/core-node`](https://www.npmjs.com/package/@palamedes/core-node)
- [`@palamedes/core-node-darwin-arm64`](https://www.npmjs.com/package/@palamedes/core-node-darwin-arm64)
- [`@palamedes/core-node-linux-x64-gnu`](https://www.npmjs.com/package/@palamedes/core-node-linux-x64-gnu)
- [`@palamedes/core-node-linux-arm64-gnu`](https://www.npmjs.com/package/@palamedes/core-node-linux-arm64-gnu)

## License

MIT © Sebastian Software GmbH
