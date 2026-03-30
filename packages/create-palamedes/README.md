# create-palamedes

[![npm version](https://img.shields.io/npm/v/create-palamedes?logo=npm)](https://www.npmjs.com/package/create-palamedes)
[![CI](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml)
[![Sponsored by Sebastian Software](https://img.shields.io/badge/Sponsored%20by-Sebastian%20Software-0f172a.svg)](https://oss.sebastian-software.com/)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f172a.svg)](https://github.com/sebastian-software/palamedes/blob/main/LICENSE)

Reserved package name for the future `pnpm create palamedes` experience.

Today this package is intentionally minimal. It exists so Palamedes can grow into a proper first-run scaffold without losing the canonical npm entry point later.

## When To Use This Package

Right now, you probably should not.

`create-palamedes` is a placeholder package that prints a short status message and exits. Once scaffolding lands, this will become the natural starting point for `pnpm create palamedes`.

## Installation

You do not need to add this package to a project today. If you are setting up Palamedes now, install the specific packages you need:

```bash
pnpm add @palamedes/core @palamedes/runtime @palamedes/vite-plugin
pnpm add -D @palamedes/cli
```

Then add either `@palamedes/react` or `@palamedes/solid`, depending on your
host framework.

For the actual setup flow today, use:

- [First working translation in 5 minutes](https://github.com/sebastian-software/palamedes/blob/main/docs/first-working-translation.md)

## Current Status

- package name is reserved
- no project generator is implemented yet
- future releases can turn this into a real scaffold without a naming migration

## Related Packages

- [`palamedes`](https://www.npmjs.com/package/palamedes)
- [`@palamedes/vite-plugin`](https://www.npmjs.com/package/@palamedes/vite-plugin)
- [`@palamedes/next-plugin`](https://www.npmjs.com/package/@palamedes/next-plugin)
- [`@palamedes/cli`](https://www.npmjs.com/package/@palamedes/cli)

## License

[![Sebastian Software](https://sebastian-brand.vercel.app/sebastian-software/logo-software.svg)](https://oss.sebastian-software.com/)

MIT © 2026 Sebastian Software
