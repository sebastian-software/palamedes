# Demo Deployments

The Palamedes example matrix is verified primarily through local runs and CI.
Automatic deployments are not part of the default merge or release path. All ten
examples are publicly accessible as a live reference — see the Live Reference
Deployment section below.

## Current Policy

- the canonical verification path is `pnpm build:examples` plus `pnpm verify:examples`
- example deployments do not run automatically on `main`
- `nextjs-cookie` and `nextjs-route` are excluded from `deploy-examples.yml`; both are accessible via the live reference deployment
- the `deploy-examples.yml` workflow supports manual deployment of the eight non-Next.js examples if an additional hosted URL is needed

## Live Reference Deployment

All ten examples are publicly accessible. Switch language in any of them and
watch copy, plural seat counts, currency, and dates change together.

| Framework | Locale strategy | Live demo |
| -------------- | --------------- | --------- |
| Next.js | cookie | [nextjs-cookie.examples.palamedes.dev](https://nextjs-cookie.examples.palamedes.dev) |
| Next.js | route | [nextjs-route.examples.palamedes.dev](https://nextjs-route.examples.palamedes.dev) |
| TanStack Start | cookie | [tanstack-cookie.examples.palamedes.dev](https://tanstack-cookie.examples.palamedes.dev) |
| TanStack Start | route | [tanstack-route.examples.palamedes.dev](https://tanstack-route.examples.palamedes.dev) |
| Waku | cookie | [waku-cookie.examples.palamedes.dev](https://waku-cookie.examples.palamedes.dev) |
| Waku | route | [waku-route.examples.palamedes.dev](https://waku-route.examples.palamedes.dev) |
| React Router | cookie | [react-router-cookie.examples.palamedes.dev](https://react-router-cookie.examples.palamedes.dev) |
| React Router | route | [react-router-route.examples.palamedes.dev](https://react-router-route.examples.palamedes.dev) |
| SolidStart | cookie | [solidstart-cookie.examples.palamedes.dev](https://solidstart-cookie.examples.palamedes.dev) |
| SolidStart | route | [solidstart-route.examples.palamedes.dev](https://solidstart-route.examples.palamedes.dev) |

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

## Why Next.js Is Not In `deploy-examples.yml`

The Next.js examples are part of the verified matrix, but they are excluded from
the `deploy-examples.yml` workflow. That workflow targets the eight non-Next.js
examples specifically.

For this OSS setup, the guaranteed baseline is:

- the examples build
- the examples run locally
- SSR, locale routing, cookie handling, and localized server actions are covered in browser tests

Both `nextjs-cookie` and `nextjs-route` are nonetheless publicly accessible — see
the Live Reference Deployment section above. The hosting mechanism for the Next.js
examples is separate from `deploy-examples.yml` and is not further documented here.
