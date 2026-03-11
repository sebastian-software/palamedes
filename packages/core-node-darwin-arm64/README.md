# @palamedes/core-node-darwin-arm64

[![npm version](https://img.shields.io/npm/v/%40palamedes%2Fcore-node-darwin-arm64?logo=npm)](https://www.npmjs.com/package/@palamedes/core-node-darwin-arm64)
[![CI](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml)
[![Sponsored by Sebastian Software](https://img.shields.io/badge/Sponsored%20by-Sebastian%20Software-0f172a.svg)](https://oss.sebastian-software.com/)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f172a.svg)](https://github.com/sebastian-software/palamedes/blob/main/LICENSE)

Platform-specific native bindings for `@palamedes/core-node` on macOS arm64.

## When To Use This Package

You usually should not install this package directly.

`@palamedes/core-node` pulls in the correct native package for the current platform as an optional dependency. This package exists so Palamedes can ship native binaries in a way that works cleanly across npm, CI, and multiple operating systems.

## Installation

Install [`@palamedes/core-node`](https://www.npmjs.com/package/@palamedes/core-node) instead:

```bash
pnpm add @palamedes/core-node
```

## Package Role

- contains the `.node` binary for `darwin-arm64`
- is loaded internally by `@palamedes/core-node`
- is not a stable direct integration surface

## Related Packages

- [`@palamedes/core-node`](https://www.npmjs.com/package/@palamedes/core-node)
- [`@palamedes/core-node-linux-x64-gnu`](https://www.npmjs.com/package/@palamedes/core-node-linux-x64-gnu)
- [`@palamedes/core-node-linux-arm64-gnu`](https://www.npmjs.com/package/@palamedes/core-node-linux-arm64-gnu)
- [`@palamedes/core-node-win32-x64-msvc`](https://www.npmjs.com/package/@palamedes/core-node-win32-x64-msvc)

## License

[![Sebastian Software](https://sebastian-brand.vercel.app/sebastian-software/logo-software.svg)](https://oss.sebastian-software.com/)

MIT © 2026 Sebastian Software
