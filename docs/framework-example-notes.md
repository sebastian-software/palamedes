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
- request-local SSR through each fixture's explicit server-entry scope
- localized server functions through `@palamedes/tanstack` request middleware in `tanstack-cookie`
- `.po` loading through `@palamedes/vite-plugin`
- cookie-derived, route-derived, subdomain-derived, and tld-derived locale flows

## SolidStart

The `solidstart-cookie`, `solidstart-route`, `solidstart-subdomain`, and
`solidstart-tld` examples verify:

- Vite-based Palamedes integration in SolidStart
- SolidStart 2's Vite Environment API with Nitro v3 output
- request-local SSR plus a hook-free, document-fixed client locale
- `.po` loading through `@palamedes/vite-plugin`
- cookie-derived, route-derived, subdomain-derived, and tld-derived locale flows

Current framework note:

- the route example now uses a dynamic `/$locale` segment; this is the intended
  canonical TanStack shape and should stay under verification

## Waku

The `waku-cookie`, `waku-route`, `waku-subdomain`, and `waku-tld` examples verify:

- Waku file-based `src/pages` routing with the default adapter path
- Waku-native SSR with provider-free Palamedes rendering
- request-scoped server-action interceptor coverage through `@palamedes/waku` in `waku-cookie`
- `.po` loading through the Vite plugin path exposed via `waku.config.ts`
- cookie-derived, route-derived, subdomain-derived, and tld-derived locale flows

Palamedes-side fixes already baked into these examples:

- server-side activation for client widgets rendered during SSR, so no
  locale-local fallback copy maps are needed

Current framework note:

- **the served document always carries `<html lang="en">`.** Waku pre-renders
  `src/pages/_root.tsx` once as a static shell, so it has no access to the
  request and cannot emit a per-request locale. All four examples apply the
  active locale to `document.documentElement.lang` from the client bootstrap in
  `src/lib/i18n.ts` instead, which means a client without JavaScript — including
  a crawler that does not execute it — still sees `lang="en"` on a non-English
  document. This is a Waku constraint, not a Palamedes one; the other framework
  families render `lang` on the server. Revisit if Waku exposes a dynamic root
  or document-shell API.

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
