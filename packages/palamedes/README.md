# palamedes

[![npm version](https://img.shields.io/npm/v/palamedes?logo=npm)](https://www.npmjs.com/package/palamedes)
[![CI](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml)
[![Sponsored by Sebastian Software](https://img.shields.io/badge/Sponsored%20by-Sebastian%20Software-0f172a.svg)](https://oss.sebastian-software.com/)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f172a.svg)](https://github.com/sebastian-software/palamedes/blob/main/LICENSE)

The reserved top-level npm home for Palamedes.

Today this package is intentionally small. It secures the name so Palamedes can grow into a first-class top-level entry point later without a rename or split identity.

## When To Use This Package

Right now, mainly as a marker that the canonical package name is taken, maintained, and reserved for future expansion.

If you want to use Palamedes today, install the scoped packages directly:

- [`@palamedes/vite-plugin`](https://www.npmjs.com/package/@palamedes/vite-plugin)
- [`@palamedes/next-plugin`](https://www.npmjs.com/package/@palamedes/next-plugin)
- [`@palamedes/cli`](https://www.npmjs.com/package/@palamedes/cli)
- [`@palamedes/core`](https://www.npmjs.com/package/@palamedes/core)
- [`@palamedes/react`](https://www.npmjs.com/package/@palamedes/react)
- [`@palamedes/solid`](https://www.npmjs.com/package/@palamedes/solid)
- [`@palamedes/runtime`](https://www.npmjs.com/package/@palamedes/runtime)

## Current Status

- package name is reserved
- the included binary prints a short status message
- future releases may turn this into a first-class top-level entry point

## Recommended Starting Point Today

```bash
pnpm add @palamedes/core @palamedes/runtime @palamedes/vite-plugin
pnpm add -D @palamedes/cli
```

Then add either `@palamedes/react` or `@palamedes/solid`, depending on your
host framework.

For the real starting path, use:

- [First working translation in 5 minutes](https://github.com/sebastian-software/palamedes/blob/main/docs/first-working-translation.md)

## Related Packages

- [`create-palamedes`](https://www.npmjs.com/package/create-palamedes)
- [`@palamedes/vite-plugin`](https://www.npmjs.com/package/@palamedes/vite-plugin)
- [`@palamedes/next-plugin`](https://www.npmjs.com/package/@palamedes/next-plugin)
- [`@palamedes/cli`](https://www.npmjs.com/package/@palamedes/cli)

## License

[![Sebastian Software](https://sebastian-brand.vercel.app/sebastian-software/logo-software.svg)](https://oss.sebastian-software.com/)

MIT © 2026 Sebastian Software
