# @palamedes/cli-linux-arm64-gnu

[![npm version](https://img.shields.io/npm/v/%40palamedes%2Fcli-linux-arm64-gnu?logo=npm)](https://www.npmjs.com/package/@palamedes/cli-linux-arm64-gnu)
[![CI](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml)
[![Sponsored by Sebastian Software](https://img.shields.io/badge/Sponsored%20by-Sebastian%20Software-0f172a.svg)](https://oss.sebastian-software.com/)
[![License: MIT OR Apache-2.0](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-0f172a.svg)](https://github.com/sebastian-software/palamedes#license)

Platform-specific native `pmds` binary for `@palamedes/cli` on Linux arm64 with glibc.

## When To Use This Package

You usually should not install this package directly.

`@palamedes/cli` selects and runs the matching native package for the current platform as an optional dependency. This package ships the Linux arm64 glibc `pmds` executable in lockstep with `@palamedes/cli`. When the target platform is known ahead of time (such as a CI image or container), you can also install this package directly to run `pmds` without a Node.js launcher process.

## Installation

Install [`@palamedes/cli`](https://www.npmjs.com/package/@palamedes/cli) instead:

```bash
pnpm add -D @palamedes/cli
```

## Package Role

- contains the native `pmds` executable and UI catalogs (`bin/pmds-locales/`) for `linux-arm64-gnu`
- is selected automatically by `@palamedes/cli` and runs without Node.js
- is versioned in lockstep with `@palamedes/cli`

## Related Packages

- [`@palamedes/cli`](https://www.npmjs.com/package/@palamedes/cli)
- [`@palamedes/cli-darwin-arm64`](https://www.npmjs.com/package/@palamedes/cli-darwin-arm64)
- [`@palamedes/cli-linux-arm64-musl`](https://www.npmjs.com/package/@palamedes/cli-linux-arm64-musl)
- [`@palamedes/cli-linux-x64-gnu`](https://www.npmjs.com/package/@palamedes/cli-linux-x64-gnu)
- [`@palamedes/cli-linux-x64-musl`](https://www.npmjs.com/package/@palamedes/cli-linux-x64-musl)
- [`@palamedes/cli-win32-x64-msvc`](https://www.npmjs.com/package/@palamedes/cli-win32-x64-msvc)

## License

[![Sebastian Software](https://sebastian-brand.vercel.app/sebastian-software/logo-software.svg)](https://oss.sebastian-software.com/)

MIT OR Apache-2.0 © 2026 Sebastian Software
