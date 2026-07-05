# Framework Example Notes

This document records what each framework family in the example matrix verifies,
which quirks were fixed in Palamedes, and which remaining edges belong to the
framework/tooling layer rather than the Palamedes runtime model.

## Next.js

The `nextjs-cookie`, `nextjs-route`, `nextjs-subdomain`, and `nextjs-tld`
examples verify:

- Turbopack-based Next.js 16.2 integration
- provider-free Palamedes rendering in server components and client widgets
- `.po` loading through `@palamedes/next-plugin`
- localized `"use server"` actions
- cookie-derived, route-derived, subdomain-derived, and tld-derived locale flows

Palamedes-side fixes already baked into these examples:

- `"use client"` import injection safety in the transform path
- provider-free client widget rendering without fallback copy maps

## TanStack Start

The `tanstack-cookie`, `tanstack-route`, `tanstack-subdomain`, and
`tanstack-tld` examples verify:

- Vite-based Palamedes integration in TanStack Start
- SSR plus localized server functions
- `.po` loading through `@palamedes/vite-plugin`
- cookie-derived, route-derived, subdomain-derived, and tld-derived locale flows

## SolidStart

The `solidstart-cookie`, `solidstart-route`, `solidstart-subdomain`, and
`solidstart-tld` examples verify:

- Vite-based Palamedes integration in SolidStart
- SSR plus client reactivity through the Solid runtime bridge
- `.po` loading through `@palamedes/vite-plugin`
- cookie-derived, route-derived, subdomain-derived, and tld-derived locale flows

Current framework note:

- the route example now uses a dynamic `/$locale` segment; this is the intended
  canonical TanStack shape and should stay under verification

## Waku

The `waku-cookie`, `waku-route`, `waku-subdomain`, and `waku-tld` examples verify:

- Waku file-based `src/pages` routing with the default adapter path
- Waku-native SSR with provider-free Palamedes rendering
- localized server actions
- `.po` loading through the Vite plugin path exposed via `waku.config.ts`
- cookie-derived, route-derived, subdomain-derived, and tld-derived locale flows

Palamedes-side fixes already baked into these examples:

- server-side activation for client widgets rendered during SSR, so no
  locale-local fallback copy maps are needed

## React Router

The `react-router-cookie`, `react-router-route`, `react-router-subdomain`, and
`react-router-tld` examples verify:

- React Router framework mode with SSR and route actions
- `.po` loading through `@palamedes/vite-plugin`
- cookie-derived, route-derived, subdomain-derived, and tld-derived locale flows

Current tooling note:

- React Router builds can emit non-actionable sourcemap location warnings during
  the underlying Vite/Rollup build. The example configs now filter that known
  warning so example builds stay clean while the underlying behavior remains
  documented here.
- React Router's current dev/build toolchain still declares Vite support only
  through v7 in peer metadata, but the examples are intentionally verified on
  Vite 8. This is treated as an upstream maintenance lag, not as a blocker for
  the Palamedes example matrix.
