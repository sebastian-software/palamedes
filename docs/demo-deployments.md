# Demo Deployments

The Palamedes example matrix is verified primarily through local runs and CI.
Automatic deployments are not part of the default merge or release path. The
matrix spans twenty examples (five frameworks × four locale strategies) that
are published as a live reference — see the Live Reference Deployment section
below. The five subdomain demos additionally require the per-example wildcard DNS
records described under Subdomain Locale Hosting. The five tld demos require the
`examples.palamedes-i18n.*` domains described under TLD Locale Hosting.

## Current Policy

- the canonical verification path is `pnpm build:examples` plus `pnpm verify:examples`
- example deployments do not run automatically on `main`
- the Next.js and SolidStart examples (including their subdomain and tld variants) are excluded from `deploy-examples.yml`; they are accessible via the live reference deployment
- the `deploy-examples.yml` workflow supports manual deployment of the Vite-based examples (TanStack, Waku, React Router — cookie, route, subdomain, and tld) if an additional hosted URL is needed

## Live Reference Deployment

All twenty examples are published as a live reference — five frameworks, each
in four locale strategies. Switch language in any of them and watch copy, plural
seat counts, currency, and dates change together. The demos are grouped by
framework below, with every locale-specific URL linked directly.

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

### SolidStart

| Strategy  | Live demos                                                                                                                                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cookie    | [solidstart-cookie.examples.palamedes.dev](https://solidstart-cookie.examples.palamedes.dev)                                                                                                                           |
| route     | [en](https://solidstart-route.examples.palamedes.dev/en) · [de](https://solidstart-route.examples.palamedes.dev/de) · [es](https://solidstart-route.examples.palamedes.dev/es)                                         |
| subdomain | [en](https://en.solidstart-subdomain.examples.palamedes.dev) · [de](https://de.solidstart-subdomain.examples.palamedes.dev) · [es](https://es.solidstart-subdomain.examples.palamedes.dev)                             |
| tld       | [en](https://solidstart.examples.palamedes-i18n.com) · [de](https://solidstart.examples.palamedes-i18n.de) · [es](https://solidstart.examples.palamedes-i18n.es) · [fr](https://solidstart.examples.palamedes-i18n.fr) |

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

## TLD Locale Hosting (DNS And Reverse Proxy)

The tld demos derive the locale from the top-level domain of the request host.
Each framework example is reachable under four TLDs:

- `nextjs.examples.palamedes-i18n.com` / `.de` / `.es` / `.fr`
- `tanstack.examples.palamedes-i18n.com` / `.de` / `.es` / `.fr`
- `waku.examples.palamedes-i18n.com` / `.de` / `.es` / `.fr`
- `react-router.examples.palamedes-i18n.com` / `.de` / `.es` / `.fr`
- `solidstart.examples.palamedes-i18n.com` / `.de` / `.es` / `.fr`

All four TLD variants of a given framework point to the same backend. The
reverse proxy must pass the original `Host` header through unchanged — the app
reads the TLD to select the locale, so it is authoritative. `.de`, `.es`, and
`.fr` are authoritative automatically (country code equals language code); the
generic `.com` is mapped to `en` through an explicit `tld` override. A
multi-lingual country TLD such as `.ch` would intentionally be left unmapped
(non-authoritative), falling back to `Accept-Language` or the default locale.

Because locale and switch links are derived from the request host, responses must
not be cached host-agnostically. Any cache in front of a tld example must include
the `Host` in its cache key (or the app must send `Vary: Host`); otherwise a
response for one TLD could be served for another. This is the same constraint the
per-host routing already implies, but it must hold for caching layers too.

Until these domains are provisioned, the five tld rows in the Live Reference table
are not yet reachable. The canonical verification path runs locally via
`pnpm verify:examples`, which exercises the tld strategy using Chromium's
`--host-resolver-rules` flag to simulate the TLD hosts without real DNS.

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
- `tanstack-tld`
- `waku-tld`
- `react-router-tld`

## Why Next.js Is Not In `deploy-examples.yml`

The Next.js examples are part of the verified matrix, but they are excluded from
the `deploy-examples.yml` workflow. That workflow targets the Vite-based examples
(TanStack, Waku, React Router — cookie, route, subdomain, and tld) specifically.

For this OSS setup, the guaranteed baseline is:

- the examples build
- the examples run locally
- SSR, locale routing, cookie handling, and localized server actions are covered in browser tests

Both `nextjs-cookie` and `nextjs-route` are nonetheless publicly accessible — see
the Live Reference Deployment section above. The hosting mechanism for the Next.js
examples is separate from `deploy-examples.yml` and is not further documented here.
