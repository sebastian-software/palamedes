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

The route example uses a dynamic `/$locale` segment and verifies locale
redirects, SSR, and later server-function calls.

These examples pin React Start 1.169.4 with TanStack Router 1.170.46.
For v2, TanStack Start is verified with React; Solid is verified separately
through the Solid 2 Start Mode/Nitro examples below. TanStack Solid Start is
outside the v2 scope. The examples serve as both adoption demos and integration
tests rather than an exhaustive cross-product of frameworks and renderers.

Run the production smoke and browser checks for either family:

```sh
pnpm verify:examples:smoke --framework tanstack
pnpm verify:examples:browser --framework tanstack
pnpm verify:examples:smoke --framework solid
pnpm verify:examples:browser --framework solid
```

The smoke checks include deterministically overlapping locale requests. Browser
checks cover hydration, interaction, navigation, and locale switching. Each
family's cookie example additionally runs initial/lazy catalog failure and
recovery checks and development invalidation proofs. A rendered screenshot alone
does not satisfy this verification contract.

The [Example Verification workflow](../.github/workflows/example-verification.yml)
runs these checks on relevant pull requests and `main` changes, plus a weekly
regression run. The demos therefore remain checked integration fixtures after
the initial acceptance run.

## Solid

The `solid-cookie`, `solid-route`, `solid-subdomain`, and
`solid-tld` examples verify:

- Vite-based Palamedes integration in Solid
- Solid 2.0.0-rc.16 and `@solidjs/web@2.0.0-rc.16`
- `@solidjs/vite-plugin@3.0.0-next.50` Start Mode and Nitro v3 output
- `@solidjs/router@2.0.0-next.41` with `filesystem-routing@0.4.0`
- request-local SSR plus a hook-free, document-fixed client locale
- `.po` loading through `@palamedes/vite-plugin`
- cookie-derived, route-derived, subdomain-derived, and tld-derived locale flows

The route example uses `[locale].tsx` for its dynamic segment, following Solid
Router's bracketed file-route convention (rather than TanStack's `$locale`
filename convention).

Current framework note:

- Solid Router intercepts same-origin anchor clicks, so a locale link would
  navigate on the client and leave the previously activated catalog under the new
  document. `solid-route` marks its locale links `rel="external"` — the
  router's own opt-out — so the strategy switch stays a document load. The other
  Solid examples switch across hosts or assign `window.location`, so only
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

- All four examples intentionally render `src/pages/_root.tsx` dynamically so
  the server can resolve the locale from the current request and emit it in the
  initial `<html lang="...">`. The client bootstrap in `src/lib/i18n.ts` still
  assigns the same locale to `document.documentElement.lang`; that assignment
  is idempotent and keeps the client state aligned with the served document.

## Remix v3

The `remix-cookie`, `remix-route`, `remix-subdomain`, and `remix-tld` examples
verify the same four locale strategies through Remix's controller
API. Route examples include the fixed `lvh.me` host map; the tld example
includes French alongside English, German, and Spanish. All non-cookie
strategies submit a normal locale-choice form before navigating to their
canonical URL, so an explicit choice is retained for later mismatch hints
without introducing client-side locale switching.

`remix-cookie` is also the focused full-stack proof. Its Chromium contract
checks Spanish SSR and hydration, the browser asset transform, ordinary and
rich Remix UI macros, interaction, Frames, and a full-navigation switch to
German without hydration or console errors.

## React Router

The `react-router-cookie`, `react-router-route`, `react-router-subdomain`, and
`react-router-tld` examples verify:

- React Router framework mode with SSR and route actions
- `.po` loading through `@palamedes/vite-plugin`
- cookie-derived, route-derived, subdomain-derived, and tld-derived locale flows

The [React Router Framework Mode guide](./api/react-router.md) describes the
server wiring these examples use.

Current tooling note:

- React Router builds can emit non-actionable sourcemap location warnings during
  the underlying Vite/Rollup build. The example configs now filter that known
  warning so example builds stay clean while the underlying behavior remains
  documented here.
- `@react-router/dev@8.3.1` declares `vite: ^7.0.0 || ^8.0.0` as its peer
  range. The examples are verified on Vite 8.
