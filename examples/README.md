# Palamedes Example Matrix

These examples are the strongest visible proof that Palamedes is more than a
single-framework integration.

They prove the current Palamedes story across five framework families and four
locale strategies while preserving the same underlying runtime and identity
model.

The matrix is intended to be run locally and validated in CI — that remains the
canonical verification path. All twenty examples are also publicly accessible as
a live reference: the cookie, route, and subdomain demos at `*.examples.palamedes.dev`
(the subdomain demos additionally require per-example wildcard DNS records), and
the tld demos at `<framework>.palamedes-i18n.{com,de,es,fr}` — see
[docs/demo-deployments.md](../docs/demo-deployments.md) for hosting details.

## What This Matrix Proves

- one i18n mental model across Next.js, TanStack Start, SolidStart, Waku, and React Router
- one runtime story with request-local server i18n plus client interaction
- one message identity story through source-string-first `.po` workflows
- one proof surface with browser verification, screenshots, and SSR checks

That is the real point of the matrix. It is not a pile of demos. It is the
evidence behind the claim that Palamedes stays coherent across frameworks.

## Live Demos

All twenty matrix examples are publicly deployed as a live reference. Switch
language in any of them and watch copy, plural seat counts, currency, and dates
change together — the same design across every framework. For the subdomain demos
the locale is the leftmost DNS label (`en.`/`de.`/`es.`); the links below use
`en.` as the entry point. For the tld demos the locale is derived from the
top-level domain (`.de`→de, `.es`→es, `.fr`→fr); the links below use `.com` as
the non-authoritative entry point.

| Framework      | Locale strategy | Live demo                                                                                                    |
| -------------- | --------------- | ------------------------------------------------------------------------------------------------------------ |
| Next.js        | cookie          | [nextjs-cookie.examples.palamedes.dev](https://nextjs-cookie.examples.palamedes.dev)                         |
| Next.js        | route           | [nextjs-route.examples.palamedes.dev](https://nextjs-route.examples.palamedes.dev)                           |
| Next.js        | subdomain       | [en.nextjs-subdomain.examples.palamedes.dev](https://en.nextjs-subdomain.examples.palamedes.dev)             |
| TanStack Start | cookie          | [tanstack-cookie.examples.palamedes.dev](https://tanstack-cookie.examples.palamedes.dev)                     |
| TanStack Start | route           | [tanstack-route.examples.palamedes.dev](https://tanstack-route.examples.palamedes.dev)                       |
| TanStack Start | subdomain       | [en.tanstack-subdomain.examples.palamedes.dev](https://en.tanstack-subdomain.examples.palamedes.dev)         |
| Waku           | cookie          | [waku-cookie.examples.palamedes.dev](https://waku-cookie.examples.palamedes.dev)                             |
| Waku           | route           | [waku-route.examples.palamedes.dev](https://waku-route.examples.palamedes.dev)                               |
| Waku           | subdomain       | [en.waku-subdomain.examples.palamedes.dev](https://en.waku-subdomain.examples.palamedes.dev)                 |
| React Router   | cookie          | [react-router-cookie.examples.palamedes.dev](https://react-router-cookie.examples.palamedes.dev)             |
| React Router   | route           | [react-router-route.examples.palamedes.dev](https://react-router-route.examples.palamedes.dev)               |
| React Router   | subdomain       | [en.react-router-subdomain.examples.palamedes.dev](https://en.react-router-subdomain.examples.palamedes.dev) |
| SolidStart     | cookie          | [solidstart-cookie.examples.palamedes.dev](https://solidstart-cookie.examples.palamedes.dev)                 |
| SolidStart     | route           | [solidstart-route.examples.palamedes.dev](https://solidstart-route.examples.palamedes.dev)                   |
| SolidStart     | subdomain       | [en.solidstart-subdomain.examples.palamedes.dev](https://en.solidstart-subdomain.examples.palamedes.dev)     |
| Next.js        | tld             | [nextjs.palamedes-i18n.com](https://nextjs.palamedes-i18n.com)                                               |
| TanStack Start | tld             | [tanstack.palamedes-i18n.com](https://tanstack.palamedes-i18n.com)                                           |
| Waku           | tld             | [waku.palamedes-i18n.com](https://waku.palamedes-i18n.com)                                                   |
| React Router   | tld             | [react-router.palamedes-i18n.com](https://react-router.palamedes-i18n.com)                                   |
| SolidStart     | tld             | [solidstart.palamedes-i18n.com](https://solidstart.palamedes-i18n.com)                                       |

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

### Subdomain-Derived Locale

- [examples/nextjs-subdomain](/Users/sebastian/Workspace/business/palamedes/examples/nextjs-subdomain)
- [examples/tanstack-subdomain](/Users/sebastian/Workspace/business/palamedes/examples/tanstack-subdomain)
- [examples/solidstart-subdomain](/Users/sebastian/Workspace/business/palamedes/examples/solidstart-subdomain)
- [examples/waku-subdomain](/Users/sebastian/Workspace/business/palamedes/examples/waku-subdomain)
- [examples/react-router-subdomain](/Users/sebastian/Workspace/business/palamedes/examples/react-router-subdomain)

These examples prove:

- the leftmost DNS label as the authoritative locale (`de.<app>` -> `de`), no `/:locale/...` prefix
- `resolve({ strategy: "subdomain", requestHost })` with a base-domain-independent `hosts: { mode: "subdomain" }` config
- `Accept-Language` mismatch detection via the same visible info bar
- locale switching as a full document load to the sibling host (leftmost label swapped)
- SSR with localized server actions or server functions

### TLD-Derived Locale

- [examples/nextjs-tld](/Users/sebastian/Workspace/business/palamedes/examples/nextjs-tld)
- [examples/tanstack-tld](/Users/sebastian/Workspace/business/palamedes/examples/tanstack-tld)
- [examples/solidstart-tld](/Users/sebastian/Workspace/business/palamedes/examples/solidstart-tld)
- [examples/waku-tld](/Users/sebastian/Workspace/business/palamedes/examples/waku-tld)
- [examples/react-router-tld](/Users/sebastian/Workspace/business/palamedes/examples/react-router-tld)

These examples prove:

- the rightmost DNS label (TLD) as the authoritative locale (`.de` → de), no `/:locale/...` prefix
- three-level resolution: automatic when country code equals language code, explicit tld map for others, otherwise `Accept-Language` or default
- `.com` is non-authoritative — falls back to `Accept-Language` or the default locale (en)
- `resolve({ strategy: "tld", requestHost })` with `hosts: { mode: "tld", defaultTld: "com" }`
- locale switching as a full document reload with the TLD swapped
- SSR with localized server actions or server functions

## Shared Runtime Model

All matrix examples use the same public Palamedes stack:

- `@palamedes/core`
- `@palamedes/react` or `@palamedes/solid`
- `@palamedes/runtime`
- `@palamedes/vite-plugin` or `@palamedes/next-plugin`

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

For the decision model behind cookie, route, subdomain, tld, and domain handling, see:

- [docs/locale-strategies.md](/Users/sebastian/Workspace/business/palamedes/docs/locale-strategies.md)
- [docs/framework-example-notes.md](/Users/sebastian/Workspace/business/palamedes/docs/framework-example-notes.md)
- [docs/example-screenshots/README.md](/Users/sebastian/Workspace/business/palamedes/docs/example-screenshots/README.md)
- [docs/demo-deployments.md](/Users/sebastian/Workspace/business/palamedes/docs/demo-deployments.md)

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
