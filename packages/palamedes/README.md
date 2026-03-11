# palamedes

[![npm version](https://img.shields.io/npm/v/palamedes?logo=npm)](https://www.npmjs.com/package/palamedes)
[![CI](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f172a.svg)](https://github.com/sebastian-software/palamedes/blob/main/LICENSE)

The reserved top-level npm package for the Palamedes toolchain.

Today this package is intentionally small. It secures the canonical package name and gives the project room for a future top-level CLI, starter experience, or unified entry point without a rename later.

## When To Use This Package

Right now, mostly as a marker that the canonical package name is taken and maintained by the project.

If you want to use Palamedes today, install the scoped packages directly:

- [`@palamedes/vite-plugin`](https://www.npmjs.com/package/@palamedes/vite-plugin)
- [`@palamedes/next-plugin`](https://www.npmjs.com/package/@palamedes/next-plugin)
- [`@palamedes/cli`](https://www.npmjs.com/package/@palamedes/cli)
- [`@palamedes/runtime`](https://www.npmjs.com/package/@palamedes/runtime)

## Current Status

- package name is reserved
- the included binary prints a short status message
- future releases may turn this into a first-class top-level entry point

## Recommended Starting Point Today

```bash
pnpm add @palamedes/vite-plugin @palamedes/runtime @lingui/core @lingui/react
pnpm add -D @palamedes/cli
```

## Related Packages

- [`create-palamedes`](https://www.npmjs.com/package/create-palamedes)
- [`@palamedes/vite-plugin`](https://www.npmjs.com/package/@palamedes/vite-plugin)
- [`@palamedes/next-plugin`](https://www.npmjs.com/package/@palamedes/next-plugin)
- [`@palamedes/cli`](https://www.npmjs.com/package/@palamedes/cli)

## License

MIT © 2026 [Sebastian Software](https://oss.sebastian-software.com/)
