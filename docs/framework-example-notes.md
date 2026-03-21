# Framework Example Notes

This document records what each framework family in the example matrix proves,
which quirks were fixed in Palamedes, and which remaining edges belong to the
framework/tooling layer rather than the Palamedes runtime model.

## Next.js

The `nextjs-cookie` and `nextjs-route` examples prove:

- Turbopack-based Next.js 16.2 integration
- provider-free Palamedes rendering in server components and client widgets
- `.po` loading through `@palamedes/next-plugin`
- localized `"use server"` actions
- cookie-derived and route-derived locale flows

Palamedes-side fixes already baked into these examples:

- `"use client"` import injection safety in the transform path
- provider-free client widget rendering without fallback copy maps

## TanStack Start

The `tanstack-cookie` and `tanstack-route` examples prove:

- Vite-based Palamedes integration in TanStack Start
- SSR plus localized server functions
- `.po` loading through `@palamedes/vite-plugin`
- cookie-derived and route-derived locale flows

Current framework note:

- the route example now uses a dynamic `/$locale` segment; this is the intended
  canonical TanStack shape and should stay under verification

## Waku

The `waku-cookie` and `waku-route` examples prove:

- Waku-native SSR with provider-free Palamedes rendering
- localized server actions
- `.po` loading through the Vite plugin path exposed via `waku.config.ts`
- cookie-derived and route-derived locale flows

Palamedes-side fixes already baked into these examples:

- server-side activation for client widgets rendered during SSR, so no
  locale-local fallback copy maps are needed

Current tooling notes:

- the example build emits a known Waku/Vite chunking warning when the root app
  component is both statically referenced by the server entry and dynamically
  referenced by Waku's generated server-reference layer
- the central browser verifier currently skips the in-browser server-action
  assertion for Waku, and for the route variant it limits itself to the initial
  SSR/render proof instead of driving the interactive route switch in-browser;
  smoke checks still cover route/cookie behavior and mismatch banners, while
  the live examples remain the manual proof surface for those Waku-specific
  interactions

## React Router

The `react-router-cookie` and `react-router-route` examples prove:

- React Router framework mode with SSR and route actions
- `.po` loading through `@palamedes/vite-plugin`
- cookie-derived and route-derived locale flows

Current tooling note:

- React Router builds can emit non-actionable sourcemap location warnings during
  the underlying Vite/Rollup build. The example configs now filter that known
  warning so example builds stay clean while the underlying behavior remains
  documented here.
