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

The route example uses a dynamic `/$locale` segment; this is the canonical
TanStack shape and remains under verification.

## SolidStart

The `solidstart-cookie`, `solidstart-route`, `solidstart-subdomain`, and
`solidstart-tld` examples verify:

- Vite-based Palamedes integration in SolidStart
- SolidStart 2's Vite Environment API with Nitro v3 output
- request-local SSR plus a hook-free, document-fixed client locale
- `.po` loading through `@palamedes/vite-plugin`
- cookie-derived, route-derived, subdomain-derived, and tld-derived locale flows

The route example uses `[locale].tsx` for its dynamic segment, following Solid
Router's bracketed file-route convention (rather than TanStack's `$locale`
filename convention).

Current framework note:

- Solid Router intercepts same-origin anchor clicks, so a locale link would
  navigate on the client and leave the previously activated catalog under the new
  document. `solidstart-route` marks its locale links `rel="external"` — the
  router's own opt-out — so the strategy switch stays a document load. The other
  SolidStart examples switch across hosts or assign `window.location`, so only
  the route example needs it.

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

## Remix v3

The `remix-cookie`, `remix-route`, `remix-subdomain`, and `remix-tld` examples
verify the same four locale strategies through Remix's server-first controller
API. Route examples include the fixed `lvh.me` host map; the tld example
includes French alongside English, German, and Spanish. All non-cookie
strategies submit a normal locale-choice form before navigating to their
canonical URL, so an explicit choice is retained for later mismatch hints
without introducing client-side locale switching.

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
