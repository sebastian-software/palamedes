# Demo Deployments

The Palamedes example matrix is verified primarily through local runs and CI.
Automatic deployments are not part of the default merge or release path. The
matrix spans fifteen examples (five frameworks × three locale strategies) that
are published as a live reference — see the Live Reference Deployment section
below. The five subdomain demos additionally require the per-example wildcard DNS
records described under Subdomain Locale Hosting.

## Current Policy

- the canonical verification path is `pnpm build:examples` plus `pnpm verify:examples`
- example deployments do not run automatically on `main`
- the Next.js and SolidStart examples (including their subdomain variants) are excluded from `deploy-examples.yml`; they are accessible via the live reference deployment
- the `deploy-examples.yml` workflow supports manual deployment of the Vite-based examples (TanStack, Waku, React Router — cookie, route, and subdomain) if an additional hosted URL is needed

## Live Reference Deployment

All fifteen examples are published as a live reference. Switch language in any of
them and watch copy, plural seat counts, currency, and dates change together. For
the subdomain demos the locale is the leftmost DNS label
(`en.`/`de.`/`es.`); the links below use `en.` as the entry point.

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

## Subdomain Locale Hosting (DNS And Reverse Proxy)

The subdomain demos encode the locale in the leftmost DNS label
(`de.nextjs-subdomain.examples.palamedes.dev` renders German). That label sits one
level below the existing `*.examples.palamedes.dev` wildcard, which only covers a
single label: it resolves `nextjs-subdomain.examples.palamedes.dev` but not
`de.nextjs-subdomain.examples.palamedes.dev`. Each subdomain example therefore
needs its own wildcard record:

- `*.nextjs-subdomain.examples.palamedes.dev`
- `*.tanstack-subdomain.examples.palamedes.dev`
- `*.waku-subdomain.examples.palamedes.dev`
- `*.react-router-subdomain.examples.palamedes.dev`
- `*.solidstart-subdomain.examples.palamedes.dev`

(Five records, same record type and target as the existing wildcard.)

The reverse proxy routes every locale host of one example
(`en.`/`de.`/`es.<app>-subdomain.examples.palamedes.dev`) to that example's single
backend and must pass the original `Host` header through unchanged — the app reads
it to select the locale, so it is authoritative. As with the other demos, only
domain names appear here; the host-to-backend port assignment lives in the internal
proxy configuration, not in this document.

Because the locale — and the switch/suggestion links the app renders — are derived
from the request host, responses must not be cached host-agnostically. Any cache in
front of a subdomain example must include the `Host` in its cache key (or the app
must send `Vary: Host`); otherwise a response rendered for one locale host could be
served for another. This is the same constraint the per-host routing already
implies, but it must hold for caching layers too.

Until these records and proxy routes exist, the five subdomain rows above are not
yet reachable; the canonical verification path remains `pnpm verify:examples`,
which exercises the subdomain strategy locally via `*.lvh.me` hosts.

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
- `tanstack-subdomain`
- `waku-cookie`
- `waku-route`
- `waku-subdomain`
- `react-router-cookie`
- `react-router-route`
- `react-router-subdomain`

## Why Next.js Is Not In `deploy-examples.yml`

The Next.js examples are part of the verified matrix, but they are excluded from
the `deploy-examples.yml` workflow. That workflow targets the Vite-based examples
(TanStack, Waku, React Router — cookie, route, and subdomain) specifically.

For this OSS setup, the guaranteed baseline is:

- the examples build
- the examples run locally
- SSR, locale routing, cookie handling, and localized server actions are covered in browser tests

Both `nextjs-cookie` and `nextjs-route` are nonetheless publicly accessible — see
the Live Reference Deployment section above. The hosting mechanism for the Next.js
examples is separate from `deploy-examples.yml` and is not further documented here.
