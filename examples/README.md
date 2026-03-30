# Palamedes Example Matrix

These examples are the strongest visible proof that Palamedes is more than a
single-framework integration.

They prove the current Palamedes story across five framework families and two
locale strategies while preserving the same underlying runtime and identity
model.

The matrix is intended to be run locally and validated in CI. Public hosting is
optional and not part of the default example story.

## What This Matrix Proves

- one i18n mental model across Next.js, TanStack Start, SolidStart, Waku, and React Router
- one runtime story with request-local server i18n plus client interaction
- one message identity story through source-string-first `.po` workflows
- one proof surface with browser verification, screenshots, and SSR checks

That is the real point of the matrix. It is not a pile of demos. It is the
evidence behind the claim that Palamedes stays coherent across frameworks.

## Locale Strategy Matrix

### Cookie-Derived Locale

- [examples/nextjs-cookie](/Users/sebastian/Workspace/business/palamedes/examples/nextjs-cookie)
- [examples/tanstack-cookie](/Users/sebastian/Workspace/business/palamedes/examples/tanstack-cookie)
- [examples/solidstart-cookie](/Users/sebastian/Workspace/business/palamedes/examples/solidstart-cookie)
- [examples/waku-cookie](/Users/sebastian/Workspace/business/palamedes/examples/waku-cookie)
- [examples/react-router-cookie](/Users/sebastian/Workspace/business/palamedes/examples/react-router-cookie)

These examples prove:

- first-visit locale detection from `Accept-Language`
- cookie persistence after an explicit locale switch
- SSR with a request-local Palamedes i18n instance
- `.po` imports in real app builds
- localized server-side actions or server functions

### Route-Derived Locale

- [examples/nextjs-route](/Users/sebastian/Workspace/business/palamedes/examples/nextjs-route)
- [examples/tanstack-route](/Users/sebastian/Workspace/business/palamedes/examples/tanstack-route)
- [examples/solidstart-route](/Users/sebastian/Workspace/business/palamedes/examples/solidstart-route)
- [examples/waku-route](/Users/sebastian/Workspace/business/palamedes/examples/waku-route)
- [examples/react-router-route](/Users/sebastian/Workspace/business/palamedes/examples/react-router-route)

These examples prove:

- locale in the URL via `/:locale/...`
- host/domain mapping as an extension of the route model
- wrong-locale or wrong-domain detection via a visible info bar
- redirect/switch CTA generation without automatic redirects
- SSR with localized server actions or server functions

## Shared Runtime Model

All matrix examples use the same public Palamedes stack:

- `@palamedes/core`
- `@palamedes/react` or `@palamedes/solid`
- `@palamedes/runtime`
- `@palamedes/vite-plugin` or `@palamedes/next-plugin`

Shared locale and routing proof logic lives in the internal package:

- [packages/example-locale-shared](/Users/sebastian/Workspace/business/palamedes/packages/example-locale-shared)

## Verification

Workspace-level example builds:

```bash
pnpm build:examples
```

Central example verification:

```bash
pnpm verify:examples
pnpm verify:examples -- --framework nextjs
pnpm verify:examples -- --strategy route
```

Versioned browser screenshots:

```bash
pnpm capture:example-screenshots
pnpm capture:example-screenshots -- --id nextjs-cookie
```

The verifier runs in two layers:

- fast Node-based smoke checks from [scripts/verify-examples.mjs](/Users/sebastian/Workspace/business/palamedes/scripts/verify-examples.mjs)
- browser interaction checks from `Vitest` using direct `Playwright` automation against the running apps

Together they cover:

- SSR output
- first-visit `Accept-Language` handling
- route-locale rendering
- host/domain mismatch banners
- canonical redirect/switch targets
- locale switching
- localized server action or server function output after interaction

For the decision model behind cookie, route, and domain handling, see:

- [docs/locale-strategies.md](/Users/sebastian/Workspace/business/palamedes/docs/locale-strategies.md)
- [docs/framework-example-notes.md](/Users/sebastian/Workspace/business/palamedes/docs/framework-example-notes.md)
- [docs/example-screenshots/README.md](/Users/sebastian/Workspace/business/palamedes/docs/example-screenshots/README.md)
- [docs/demo-deployments.md](/Users/sebastian/Workspace/business/palamedes/docs/demo-deployments.md)

## Default Dev Ports

The example scripts use a fixed port layout so the apps can run in parallel:

- `4010` `nextjs-cookie`
- `4011` `nextjs-route`
- `4020` `tanstack-cookie`
- `4021` `tanstack-route`
- `4030` `waku-cookie`
- `4031` `waku-route`
- `4040` `react-router-cookie`
- `4041` `react-router-route`
- `4050` `solidstart-cookie`
- `4051` `solidstart-route`
