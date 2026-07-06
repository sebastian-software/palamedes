# Palamedes Example Matrix

These examples are the strongest visible proof that Palamedes is more than a
single-framework integration.

They prove the current Palamedes story across five framework families and four
locale strategies while preserving the same underlying runtime and identity
model.

The matrix is intended to be run locally and validated in CI — that remains the
canonical verification path. Public demo URLs are documented as the live
reference surface, but reachability depends on the hosting and DNS rows in
[docs/demo-deployments.md](../docs/demo-deployments.md).

This file is the canonical documentation for the full matrix. Individual
example READMEs are optional and should stay short; add one only when a specific
example needs local setup notes that do not belong in the shared matrix guide.

## What This Matrix Proves

- one i18n mental model across Next.js, TanStack Start, SolidStart, Waku, and React Router
- one runtime story with request-local server i18n plus client interaction
- one message identity story through source-string-first `.po` workflows
- one proof surface with browser verification, screenshots, and SSR checks

That is the real point of the matrix. It is not a pile of demos. It is the
evidence behind the claim that Palamedes stays coherent across frameworks.

## Live Reference URLs

The URLs below are the intended public reference shape for the same design
across every framework. Switch language in a reachable demo and watch copy,
plural seat counts, currency, and dates change together. See
[docs/demo-deployments.md](../docs/demo-deployments.md) for current hosting
status before treating a row as publicly reachable.

How each strategy encodes the locale:

- **cookie** — one host; the locale is negotiated from `Accept-Language`, then
  persisted in a cookie, so there is no per-locale URL.
- **route** — one host; the locale is the first path segment (`/en`, `/de`, `/es`).
- **subdomain** — the leftmost DNS label is the locale
  (`de.<app>-subdomain.examples.palamedes.dev`).
- **tld** — the top-level domain is the locale
  (`<app>.examples.palamedes-i18n.de`); `.com` maps to `en` via an explicit
  override.

### Next.js

| Strategy  | Live demos                                                                                                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| cookie    | [nextjs-cookie.examples.palamedes.dev](https://nextjs-cookie.examples.palamedes.dev)                                                                                                                   |
| route     | [en](https://nextjs-route.examples.palamedes.dev/en) · [de](https://nextjs-route.examples.palamedes.dev/de) · [es](https://nextjs-route.examples.palamedes.dev/es)                                     |
| subdomain | [en](https://en.nextjs-subdomain.examples.palamedes.dev) · [de](https://de.nextjs-subdomain.examples.palamedes.dev) · [es](https://es.nextjs-subdomain.examples.palamedes.dev)                         |
| tld       | [en](https://nextjs.examples.palamedes-i18n.com) · [de](https://nextjs.examples.palamedes-i18n.de) · [es](https://nextjs.examples.palamedes-i18n.es) · [fr](https://nextjs.examples.palamedes-i18n.fr) |

### TanStack Start

| Strategy  | Live demos                                                                                                                                                                                                     |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cookie    | [tanstack-cookie.examples.palamedes.dev](https://tanstack-cookie.examples.palamedes.dev)                                                                                                                       |
| route     | [en](https://tanstack-route.examples.palamedes.dev/en) · [de](https://tanstack-route.examples.palamedes.dev/de) · [es](https://tanstack-route.examples.palamedes.dev/es)                                       |
| subdomain | [en](https://en.tanstack-subdomain.examples.palamedes.dev) · [de](https://de.tanstack-subdomain.examples.palamedes.dev) · [es](https://es.tanstack-subdomain.examples.palamedes.dev)                           |
| tld       | [en](https://tanstack.examples.palamedes-i18n.com) · [de](https://tanstack.examples.palamedes-i18n.de) · [es](https://tanstack.examples.palamedes-i18n.es) · [fr](https://tanstack.examples.palamedes-i18n.fr) |

### Waku

| Strategy  | Live demos                                                                                                                                                                                     |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cookie    | [waku-cookie.examples.palamedes.dev](https://waku-cookie.examples.palamedes.dev)                                                                                                               |
| route     | [en](https://waku-route.examples.palamedes.dev/en) · [de](https://waku-route.examples.palamedes.dev/de) · [es](https://waku-route.examples.palamedes.dev/es)                                   |
| subdomain | [en](https://en.waku-subdomain.examples.palamedes.dev) · [de](https://de.waku-subdomain.examples.palamedes.dev) · [es](https://es.waku-subdomain.examples.palamedes.dev)                       |
| tld       | [en](https://waku.examples.palamedes-i18n.com) · [de](https://waku.examples.palamedes-i18n.de) · [es](https://waku.examples.palamedes-i18n.es) · [fr](https://waku.examples.palamedes-i18n.fr) |

### React Router

| Strategy  | Live demos                                                                                                                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| cookie    | [react-router-cookie.examples.palamedes.dev](https://react-router-cookie.examples.palamedes.dev)                                                                                                                               |
| route     | [en](https://react-router-route.examples.palamedes.dev/en) · [de](https://react-router-route.examples.palamedes.dev/de) · [es](https://react-router-route.examples.palamedes.dev/es)                                           |
| subdomain | [en](https://en.react-router-subdomain.examples.palamedes.dev) · [de](https://de.react-router-subdomain.examples.palamedes.dev) · [es](https://es.react-router-subdomain.examples.palamedes.dev)                               |
| tld       | [en](https://react-router.examples.palamedes-i18n.com) · [de](https://react-router.examples.palamedes-i18n.de) · [es](https://react-router.examples.palamedes-i18n.es) · [fr](https://react-router.examples.palamedes-i18n.fr) |

### Remix v3

Remix v3 examples are local/CI proof surfaces while Remix's beta hosting and UI
adapter story settles. They are pinned to the tested Remix beta and verified by
`pnpm verify:examples:smoke -- --framework remix`.

| Strategy  | Local entry point                           |
| --------- | ------------------------------------------- |
| cookie    | [examples/remix-cookie](remix-cookie)       |
| route     | [examples/remix-route](remix-route)         |
| subdomain | [examples/remix-subdomain](remix-subdomain) |
| tld       | [examples/remix-tld](remix-tld)             |

### SolidStart

| Strategy  | Live demos                                                                                                                                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cookie    | [solidstart-cookie.examples.palamedes.dev](https://solidstart-cookie.examples.palamedes.dev)                                                                                                                           |
| route     | [en](https://solidstart-route.examples.palamedes.dev/en) · [de](https://solidstart-route.examples.palamedes.dev/de) · [es](https://solidstart-route.examples.palamedes.dev/es)                                         |
| subdomain | [en](https://en.solidstart-subdomain.examples.palamedes.dev) · [de](https://de.solidstart-subdomain.examples.palamedes.dev) · [es](https://es.solidstart-subdomain.examples.palamedes.dev)                             |
| tld       | [en](https://solidstart.examples.palamedes-i18n.com) · [de](https://solidstart.examples.palamedes-i18n.de) · [es](https://solidstart.examples.palamedes-i18n.es) · [fr](https://solidstart.examples.palamedes-i18n.fr) |

## Locale Strategy Matrix

### Cookie-Derived Locale

- [examples/nextjs-cookie](examples/nextjs-cookie)
- [examples/tanstack-cookie](examples/tanstack-cookie)
- [examples/solidstart-cookie](examples/solidstart-cookie)
- [examples/waku-cookie](examples/waku-cookie)
- [examples/react-router-cookie](examples/react-router-cookie)
- [examples/remix-cookie](examples/remix-cookie)

These examples prove:

- first-visit locale detection from `Accept-Language`
- cookie persistence after an explicit locale switch
- SSR with a request-local Palamedes i18n instance
- `.po` imports in real app builds
- localized server-side actions or server functions

### Route-Derived Locale

- [examples/nextjs-route](examples/nextjs-route)
- [examples/tanstack-route](examples/tanstack-route)
- [examples/solidstart-route](examples/solidstart-route)
- [examples/waku-route](examples/waku-route)
- [examples/react-router-route](examples/react-router-route)
- [examples/remix-route](examples/remix-route)

These examples prove:

- locale in the URL via `/:locale/...`
- host/domain mapping as an extension of the route model
- wrong-locale or wrong-domain detection via a visible info bar
- redirect/switch CTA generation without automatic redirects
- SSR with localized server actions or server functions

### Subdomain-Derived Locale

- [examples/nextjs-subdomain](examples/nextjs-subdomain)
- [examples/tanstack-subdomain](examples/tanstack-subdomain)
- [examples/solidstart-subdomain](examples/solidstart-subdomain)
- [examples/waku-subdomain](examples/waku-subdomain)
- [examples/react-router-subdomain](examples/react-router-subdomain)
- [examples/remix-subdomain](examples/remix-subdomain)

These examples prove:

- the leftmost DNS label as the authoritative locale (`de.<app>` -> `de`), no `/:locale/...` prefix
- `resolve({ strategy: "subdomain", requestHost })` with a base-domain-independent `hosts: { mode: "subdomain" }` config
- `Accept-Language` mismatch detection via the same visible info bar
- locale switching as a full document load to the sibling host (leftmost label swapped)
- SSR with localized server actions or server functions

### TLD-Derived Locale

- [examples/nextjs-tld](examples/nextjs-tld)
- [examples/tanstack-tld](examples/tanstack-tld)
- [examples/solidstart-tld](examples/solidstart-tld)
- [examples/waku-tld](examples/waku-tld)
- [examples/react-router-tld](examples/react-router-tld)
- [examples/remix-tld](examples/remix-tld)

These examples prove:

- the rightmost DNS label (TLD) as the authoritative locale (`.de` → de), no `/:locale/...` prefix
- three-level resolution: automatic when country code equals language code, explicit tld map for others, otherwise `Accept-Language` or default
- the generic `.com` mapped to `en` via an explicit `tld` override (authoritative)
- `resolve({ strategy: "tld", requestHost })` with `hosts: { mode: "tld", tld: { com: "en" }, defaultTld: "com" }`
- locale switching as a full document reload with the TLD swapped
- SSR with localized server actions or server functions

## Shared Runtime Model

All matrix examples use the same public Palamedes stack:

- `@palamedes/core`
- `@palamedes/react` or `@palamedes/solid`
- `@palamedes/runtime`
- `@palamedes/vite-plugin` or `@palamedes/next-plugin`

Remix v3 support is server-first while Remix's component model and asset
pipeline settle. The Remix examples intentionally do not visually match the
React/Solid/etc. matrix yet because the shared `@palamedes/example-ui` package is
React-based and Remix's UI adapter is not implemented. They prove the same
server-side locale strategies, checked-in `.po` catalogs, and request-local i18n
through Remix's default Node loader path.

The matrix does not only prove core/runtime behavior. It also proves small
public frontend primitives from the UI packages themselves:

- `useClientLocale()` in `@palamedes/react/client`
- `createClientLocaleEffect()` in `@palamedes/solid/client`
- `buildLocaleSwitchItems()` in both UI packages

Those helpers stay headless on purpose. The examples still own routing, form
submission, and locale policy, but they no longer need to reimplement the same
frontend substrate in each app.

Every example also renders the same booking ("Frontend Stage 2026") so the twenty
apps are visually identical regardless of framework. The whole visual layer is
one shared stylesheet plus one shared content source, proving that only the
markup and locale strategy differ across frameworks, not the design:

- [packages/example-ui](../packages/example-ui) — one `styles.css` and the `EVENT` content, loaded by all twenty apps

The booking surfaces every common i18n need in a real context: translated
copy, plural seat counts, a personalized greeting variable, and locale-aware
number, currency, date, and time formatting through ICU message arguments
(`{amount, number, ::currency/EUR}`, `{when, date, full}`). One locale switch
re-renders all of it at once.

Each demo wires its locale controls through the public
[`@palamedes/core/locale`](../packages/core/src/locale.ts) surface
(`defineLocaleControls`), so locale resolution, the deliberate-choice cookie,
and the suggestion decision are shared library code rather than a per-demo copy.

## Catalog Loading And Bundle Size

Examples should load only the active locale catalog on client-reachable paths.
Use dynamic imports such as `await import(\`../locales/${locale}.po\`)` when
the browser only needs one locale at a time. That gives bundlers a chance to
split catalogs into per-locale chunks.

Static imports are still useful for tiny demos or server-only modules, but they
make every imported locale reachable from that module. In copied app code with
large catalogs, prefer the dynamic import pattern unless all locales are
intentionally needed at once.

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

- fast Node-based smoke checks from [scripts/verify-examples.mjs](scripts/verify-examples.mjs)
- browser interaction checks from `Vitest` using direct `Playwright` automation against the running apps

Together they cover:

- SSR output
- first-visit `Accept-Language` handling
- route-locale rendering
- host/domain mismatch banners
- canonical redirect/switch targets
- locale switching
- localized server action or server function output after interaction

For the decision model behind cookie, route, subdomain, tld, and domain handling, see:

- [docs/locale-strategies.md](docs/locale-strategies.md)
- [docs/framework-example-notes.md](docs/framework-example-notes.md)
- [docs/example-screenshots/README.md](docs/example-screenshots/README.md)
- [docs/demo-deployments.md](docs/demo-deployments.md)

## Default Dev Ports

The example scripts use a fixed port layout so the apps can run in parallel:

- `4010` `nextjs-cookie`
- `4011` `nextjs-route`
- `4012` `nextjs-subdomain`
- `4013` `nextjs-tld`
- `4020` `tanstack-cookie`
- `4021` `tanstack-route`
- `4022` `tanstack-subdomain`
- `4023` `tanstack-tld`
- `4030` `waku-cookie`
- `4031` `waku-route`
- `4032` `waku-subdomain`
- `4033` `waku-tld`
- `4040` `react-router-cookie`
- `4041` `react-router-route`
- `4042` `react-router-subdomain`
- `4043` `react-router-tld`
- `4050` `solidstart-cookie`
- `4051` `solidstart-route`
- `4052` `solidstart-subdomain`
- `4053` `solidstart-tld`
