# Optional Demo Deployments

The Palamedes example matrix is verified primarily through local runs and CI.
Public hosting is optional and is not part of the default merge or release path.

## Current Policy

- the canonical proof surface is `pnpm build:examples` plus `pnpm verify:examples`
- example deployments do not run automatically on `main`
- `nextjs-cookie` and `nextjs-route` are CI-only in the standard workflow
- the remaining examples can still be deployed manually if a hosted URL is useful for debugging or ad hoc sharing

## Optional Manual Deployments

The optional deployment workflow lives at:

- [deploy-examples.yml](/Users/sebastian/Workspace/business/palamedes/.github/workflows/deploy-examples.yml)

It is `workflow_dispatch` only and intentionally excludes the Next.js examples.
If used, it runs:

1. target selection
2. full example verification with `pnpm verify:examples`
3. manual per-example deployment for the selected non-Next example

Supported deployment targets:

- `tanstack-cookie`
- `tanstack-route`
- `waku-cookie`
- `waku-route`
- `react-router-cookie`
- `react-router-route`

## Why Next.js Is Not In The Deploy Path

The Next.js examples are part of the verified matrix, but they are not part of
the standard Vercel deployment workflow for this repository.

For this OSS setup, the useful guarantee is:

- the examples build
- the examples run locally
- SSR, locale routing, cookie handling, and localized server actions are covered in browser tests

If hosted Next.js demos become important later, they should be treated as a
separate operational track using Vercel's normal remote-build path rather than
the current CI-first example baseline.
