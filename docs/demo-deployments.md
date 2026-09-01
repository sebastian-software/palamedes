# Demo Deployments

The Palamedes example matrix is verified primarily through local runs and CI.
The matrix spans 25 runnable examples: six frameworks × four locale strategies,
plus the Vite MDX example. Release CI publishes one shared examples container to
GitHub Container Registry; deployment from that image to the public demo
infrastructure is managed outside this repository. Public demo URLs are
documented as the live reference surface where hosting exists, but reachability
depends on the hosting and DNS notes in this document. The five publicly hosted
framework families use the per-example wildcard DNS records described under
Subdomain Locale Hosting. Their TLD rows link the 20 live public URLs across
`.com`, `.de`, `.es`, and `.fr`. Remix v3 is verified locally and in CI, but is
not a public demo deployment target.

## Current Policy

- the canonical verification path is `pnpm build:examples` plus `pnpm verify:examples`
- release commits publish the shared examples image through
  [`publish-examples-container.yml`](../.github/workflows/publish-examples-container.yml)
- the image contains the complete example matrix and starts every example on its
  fixed port
- public routing, TLS, DNS, and image rollout belong to the external demo
  infrastructure

## Remix Public Demo Readiness Gate

`remix-cookie` is the repository's focused full-stack browser proof, but a live
URL remains separate deployment work. Change a Remix matrix cell from source
only to `live` only when:

- the published examples image contains the exact pinned Remix version;
- the four-strategy smoke matrix and focused Remix Chromium job are green;
- the final HTTPS hostname is reachable through the production proxy;
- Spanish SSR/hydration, browser interaction, rich messages, Frames, and the
  full-navigation German locale switch pass against that hostname;
- the browser run reports no hydration, page, or console errors.

This gate keeps repository readiness distinct from hosting availability. Do not
publish a provisional live URL or infer readiness from container startup alone.

## Live Reference URLs

These URLs describe the intended public reference shape — six frameworks, each in
four locale strategies. Switch language in a reachable demo and watch copy,
plural seat counts, currency, and dates change together. The demos are grouped by
framework below, with every locale-specific URL linked directly where public
hosting exists. Next.js, TanStack Start, Solid, Waku, and React Router have live
public demos for all four strategies. Remix v3 rows link to source because that
beta integration is currently a local/CI proof surface.

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

| Strategy  | Live demos                                                                                                                                                                                         |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cookie    | [solid-cookie.examples.palamedes.dev](https://solid-cookie.examples.palamedes.dev)                                                                                                                 |
| route     | [en](https://solid-route.examples.palamedes.dev/en) · [de](https://solid-route.examples.palamedes.dev/de) · [es](https://solid-route.examples.palamedes.dev/es)                                    |
| subdomain | [en](https://en.solid-subdomain.examples.palamedes.dev) · [de](https://de.solid-subdomain.examples.palamedes.dev) · [es](https://es.solid-subdomain.examples.palamedes.dev)                        |
| tld       | [en](https://solid.examples.palamedes-i18n.com) · [de](https://solid.examples.palamedes-i18n.de) · [es](https://solid.examples.palamedes-i18n.es) · [fr](https://solid.examples.palamedes-i18n.fr) |

### Remix v3

Remix v3 examples are verified through the default Remix Node loader path in CI.
They are not public demo deployments yet; the separately managed hosting path
has not passed the readiness gate above.

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

These records and proxy routes are in place for Next.js, TanStack Start, Solid,
Waku, and React Router, so all five public subdomain rows are reachable and
render the requested locale. The canonical verification path remains
`pnpm verify:examples`, which exercises the subdomain strategy locally via
`*.lvh.me` hosts. Remix subdomain support is verified the same way, but it is not
included in the public DNS/proxy deployment plan.

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

DNS, reverse-proxy routes, and TLS certificates are active for all 20 public TLD
hosts across Next.js, TanStack Start, Solid, Waku, and React Router. The canonical
verification path also runs locally via `pnpm verify:examples`, which exercises
the tld strategy using Chromium's `--host-resolver-rules` flag to simulate the
TLD hosts without real DNS. Remix TLD support is covered by the same local/CI
verification path, not by public TLD deployment.

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
