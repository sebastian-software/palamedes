# Palamedes Examples

These examples are the fastest way to see the current product shape working end to end.

If you want the shortest setup path first, start with:

- [First working translation in 5 minutes](https://github.com/sebastian-software/palamedes/blob/main/docs/first-working-translation.md)

If you want full example applications, use the repos below.

## Current Example Apps

### `vite-react/`

The best proof asset for the current Vite path.

It demonstrates:

- macro transforms in a React app
- `.po` imports
- runtime locale switching
- extraction through `pmds extract`

```bash
cd examples/vite-react
pnpm install
pnpm dev
```

### `nextjs-app/`

The best proof asset for the current Next.js path.

It demonstrates:

- App Router integration
- server and client runtime wiring
- `.po` imports
- request-aware language switching
- visible server-rendered i18n proof
- localized `"use server"` action output driven by the request cookie
- verified on the default Turbopack path on Next.js 16.2

```bash
cd examples/nextjs-app
pnpm install
pnpm dev
```

### `tanstack-start/`

The best proof asset for the current TanStack Start path.

It demonstrates:

- Palamedes macros in a TanStack Start app
- `.po` imports through the existing Vite plugin path
- SSR with a request-local Palamedes i18n instance
- search-param-driven locale switching
- localized TanStack Start server function output

```bash
cd examples/tanstack-start
pnpm install
pnpm dev
```

## What These Examples Prove

- Palamedes works today as a real app-team integration, not just as isolated low-level packages
- Vite, Next.js, and TanStack Start are the primary proof paths
- the current runtime model is `getI18n()` via `@palamedes/runtime`
- source-string-first catalogs and `.po` loading are part of the real app flow

## Packages Used

- `@palamedes/vite-plugin`
- `@palamedes/next-plugin`
- `@palamedes/core`
- `@palamedes/react`
- `@palamedes/runtime`
- `@palamedes/cli`

For broader project status and benchmark methodology, see:

- [Proof, benchmarks, and current maturity](https://github.com/sebastian-software/palamedes/blob/main/docs/proof-and-benchmarks.md)
