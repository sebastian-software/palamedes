# Demo Deployments

The Palamedes example matrix is verified primarily through local runs and CI.
The matrix spans 25 runnable examples: six frameworks × four locale strategies,
plus the Vite MDX example. Release CI publishes one shared examples container to
GitHub Container Registry; deployment from that image to the public demo
infrastructure is managed outside this repository. Public demo URLs are
documented as the live reference surface where hosting exists, but reachability
depends on the hosting and DNS notes in this document. The four currently hosted
subdomain demos require the per-example wildcard DNS records described under
Subdomain Locale Hosting. The five tld rows describe the intended shape only:
the `examples.palamedes-i18n.*` domains described under TLD Locale Hosting are
not provisioned yet, so those URLs are not publicly reachable. Remix v3 is
verified locally and in CI, but is not yet a public demo deployment target.

## Current Policy

- the canonical verification path is `pnpm build:examples` plus `pnpm verify:examples`
- release commits publish the shared examples image through
  [`publish-examples-container.yml`](../.github/workflows/publish-examples-container.yml)
- the image contains the complete example matrix and starts every example on its
  fixed port
- public routing, TLS, DNS, and image rollout belong to the external demo
  infrastructure

## Live Reference URLs

These URLs describe the intended public reference shape — six frameworks, each in
four locale strategies. Switch language in a reachable demo and watch copy,
plural seat counts, currency, and dates change together. The demos are grouped by
framework below, with every locale-specific URL linked directly where public
hosting exists. Remix v3 rows link to source because that beta integration is
currently a local/CI proof surface.

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

### Solid

The Solid 2 examples are verified locally and in CI. Their renamed public hosts
are being provisioned and are intentionally not linked as live references until
TLS, reverse-proxy routing, and the deployed image have passed an end-to-end
check.

| Strategy  | Reference source                                        |
| --------- | ------------------------------------------------------- |
| cookie    | [examples/solid-cookie](../examples/solid-cookie)       |
| route     | [examples/solid-route](../examples/solid-route)         |
| subdomain | [examples/solid-subdomain](../examples/solid-subdomain) |
| tld       | [examples/solid-tld](../examples/solid-tld)             |

### Remix v3

Remix v3 examples are verified through the default Remix Node loader path in CI.
They are not public demo deployments yet while the Remix v3 beta hosting and UI
adapter story settles.

| Strategy  | Reference source                                        |
| --------- | ------------------------------------------------------- |
| cookie    | [examples/remix-cookie](../examples/remix-cookie)       |
| route     | [examples/remix-route](../examples/remix-route)         |
| subdomain | [examples/remix-subdomain](../examples/remix-subdomain) |
| tld       | [examples/remix-tld](../examples/remix-tld)             |

## Subdomain Locale Hosting (DNS And Reverse Proxy)

The subdomain demos encode the locale in the leftmost DNS label
(`de.nextjs-subdomain.examples.palamedes.dev` renders German). That label sits one
level below the existing `*.examples.palamedes.dev` wildcard, which only covers a
single label: it resolves `nextjs-subdomain.examples.palamedes.dev` but not
`de.nextjs-subdomain.examples.palamedes.dev`. Each public subdomain example
therefore needs its own wildcard record:

- `*.nextjs-subdomain.examples.palamedes.dev`
- `*.tanstack-subdomain.examples.palamedes.dev`
- `*.waku-subdomain.examples.palamedes.dev`
- `*.react-router-subdomain.examples.palamedes.dev`
- `*.solid-subdomain.examples.palamedes.dev`

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

These records and proxy routes are in place for Next.js, TanStack Start, Waku,
and React Router, so those four subdomain rows are publicly reachable (each
locale host returns 200 and renders its locale). The renamed Solid wildcard and
proxy route are still provisioning. The
canonical verification path remains `pnpm verify:examples`, which exercises the
subdomain strategy locally via `*.lvh.me` hosts. Remix subdomain support is
verified the same way, but it is not included in the public DNS/proxy deployment
plan yet.

## TLD Locale Hosting (DNS And Reverse Proxy)

The tld demos derive the locale from the top-level domain of the request host.
Each framework example is reachable under four TLDs:

- `nextjs.examples.palamedes-i18n.com` / `.de` / `.es` / `.fr`
- `tanstack.examples.palamedes-i18n.com` / `.de` / `.es` / `.fr`
- `waku.examples.palamedes-i18n.com` / `.de` / `.es` / `.fr`
- `react-router.examples.palamedes-i18n.com` / `.de` / `.es` / `.fr`
- `solid.examples.palamedes-i18n.com` / `.de` / `.es` / `.fr`

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

Until these domains are provisioned, the five public tld rows in the Live
Reference table are not yet reachable. The canonical verification path runs locally via
`pnpm verify:examples`, which exercises the tld strategy using Chromium's
`--host-resolver-rules` flag to simulate the TLD hosts without real DNS. Remix TLD
support is covered by the same local/CI verification path, not by public TLD
deployment yet.

## Container Image Publication

The repository publishes the examples image through
[`publish-examples-container.yml`](../.github/workflows/publish-examples-container.yml).
The workflow runs for release commits on `main` and can also be forced manually.
It builds the workspace and complete example matrix, then pushes
`ghcr.io/sebastian-software/palamedes-examples` with `latest` and commit-SHA
tags.

The image starts every example through
[`scripts/container/start-all.mjs`](../scripts/container/start-all.mjs). Fixed
ports come from the shared example matrix. Reverse-proxy routing and deployment
of a selected image tag are intentionally external to this repository.
