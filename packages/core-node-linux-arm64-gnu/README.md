# @palamedes/core-node-linux-arm64-gnu

[![npm version](https://img.shields.io/npm/v/%40palamedes%2Fcore-node-linux-arm64-gnu?logo=npm)](https://www.npmjs.com/package/@palamedes/core-node-linux-arm64-gnu)
[![CI](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f172a.svg)](https://github.com/sebastian-software/palamedes/blob/main/LICENSE)

Platform-specific native bindings for `@palamedes/core-node` on Linux arm64 with glibc.

## When To Use This Package

You usually should not install this package directly.

`@palamedes/core-node` selects the correct native package for the current runtime. This package is an internal delivery vehicle for the Linux arm64 GNU binary.

## Installation

Install [`@palamedes/core-node`](https://www.npmjs.com/package/@palamedes/core-node) instead:

```bash
pnpm add @palamedes/core-node
```

## Package Role

- contains the `.node` binary for `linux-arm64-gnu`
- is loaded internally by `@palamedes/core-node`
- is not intended as a direct public API surface

## Related Packages

- [`@palamedes/core-node`](https://www.npmjs.com/package/@palamedes/core-node)
- [`@palamedes/core-node-darwin-arm64`](https://www.npmjs.com/package/@palamedes/core-node-darwin-arm64)
- [`@palamedes/core-node-linux-x64-gnu`](https://www.npmjs.com/package/@palamedes/core-node-linux-x64-gnu)
- [`@palamedes/core-node-win32-x64-msvc`](https://www.npmjs.com/package/@palamedes/core-node-win32-x64-msvc)

## License

MIT © Sebastian Software GmbH
