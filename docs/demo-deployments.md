# Demo Deployments

The Palamedes example matrix is verified primarily through local runs and CI.
The matrix spans 25 runnable examples: six frameworks × four locale strategies,
plus the Vite MDX example. CI publishes one shared examples container to
GitHub Container Registry; deployment from that image to the public demo
infrastructure is managed outside this repository. Public demo URLs are
documented as the live reference surface where hosting exists, but reachability
depends on the hosting and DNS notes in this document. The five publicly hosted
framework families use the per-example wildcard DNS records described under
Subdomain Locale Hosting. Their TLD rows link the 20 live public URLs across
`.com`, `.de`, `.es`, and `.fr`. Remix v3 has local and CI verification; its four-strategy public rollout
awaits external deployment verification.

The planned migration of the complete matrix to one Bunny app is described in
[Shared Bunny Demo Rollout](./shared-demo-rollout.md). That runbook includes the
25-endpoint inventory, readiness, controlled image updates, hosted verification,
and rollback. Its intended hosts are not deployment receipts.

## Current Policy

- the canonical verification path is `pnpm build:examples` plus `pnpm verify:examples`
- image-relevant pushes to `main` publish the shared examples image independently
  of the package release hold through
  [`publish-examples-container.yml`](../.github/workflows/publish-examples-container.yml)
- the image contains the complete example matrix; by default it starts every
  example on its fixed port, and `PALAMEDES_EXAMPLES` selects a smaller deployment
- public routing, TLS, DNS, and image rollout belong to the external demo
  infrastructure

## Remix Public Demo Readiness Gate

All four Remix strategies have full-stack browser proofs on stable Remix 3.0.0,
but live URLs remain separate deployment work. Change a Remix matrix cell from source
only to `live` only when:

- the published examples image contains the exact pinned Remix version;
- the four-strategy smoke matrix and all four Remix Chromium runs are green;
- the final HTTPS hostname is reachable through the production proxy;
- Spanish SSR/hydration, browser interaction, rich messages, Frames, and the
  full-navigation German locale switch pass against that hostname;
- the browser run reports no hydration, page, or console errors.

This gate keeps repository readiness distinct from hosting availability. Do not
publish a provisional live URL or infer readiness from container startup alone.

### Run Each Strategy Against Its Deployed Host

Run the same stable full-stack browser contracts against the final HTTPS origins.
These are intended targets, not verified live links:

```sh
pnpm verify:examples:browser -- --id remix-cookie --base-url https://remix-cookie.examples.palamedes.dev
pnpm verify:examples:browser -- --id remix-route --base-url https://remix-route.examples.palamedes.dev
pnpm verify:examples:browser -- --id remix-subdomain --base-url https://en.remix-subdomain.examples.palamedes.dev
pnpm verify:examples:browser -- --id remix-tld --base-url https://remix.examples.palamedes-i18n.com
```

External mode requires one explicit Remix example. It skips local build, startup,
and port cleanup; Chromium uses normal TLS verification. Pass an origin without
credentials, path, query, or fragment. Route mode adds the locale path itself.
Subdomain mode starts at `en.` and visits `de.` and `es.`; TLD mode starts at
`.com` and visits `.de`, `.es`, and `.fr`. HTTP is accepted only for cookie/route
loopback rehearsal, which does not satisfy the public HTTPS gate.

Each contract checks localized SSR and browser messages, interaction, actual
locale switching, direct reloads, document/standalone Frames, and initial/lazy
failure recovery under CSP. Cookie mode also checks explicit preference writes.
The examples send a nonce-based script CSP on real server responses; failure
injection stays inside the isolated browser context. Retain output,
image digest and Git revision, origins, and the verification date. The existing
local catalog-delivery benchmark receipts remain historical measurements; these
hosted checks do not regenerate that benchmark or prove image identity.

### External Rollout Checklist

The repository includes all four servers and their fixed ports in the shared
examples image. The external infrastructure still needs:

1. A built and pushed image containing stable `remix@3.0.0`. The examples
   workflow publishes independently of `.release-policy.json`; npm and crates
   remain held. Use a main push or a manual dispatch on `main` to publish. A
   `dry_run` dispatch also accepts a branch and does not publish. The workflow
   builds the runtime image and runs all four Remix smoke contracts before
   pushing. Record its immutable image digest and Git revision from the run
   summary, then deploy that digest.
2. Four HTTP endpoints, one per fixed port, with the final hostnames below.
   Bunny Magic Containers can host one container with all four endpoints. Set
   `PALAMEDES_EXAMPLES=remix-cookie,remix-route,remix-subdomain,remix-tld` to avoid
   starting the other 21 demos. Start with one region and one replica, without
   persistent volumes or an Anycast IP. Configure custom hostname TLS and DNS
   only after the endpoints are healthy. See the rollout table below.
3. Original `Host` forwarding, HTTPS certificates, and correct locale-aware
   caching. Keep `Host` in host-strategy cache keys and preserve the response's
   `Vary` policy; respect `Cookie` and `Accept-Language` where applicable.
4. All four external commands above passing on the deployed image. Only then
   update live matrix links and reconsider the adapter's Preview tier.

[#1261](https://github.com/sebastian-software/palamedes/issues/1261) remains open
until deployment evidence is available. Local and loopback tests do not close it.

### Bunny Rollout Plan

As checked on October 19, 2026, Bunny manages the DNS zones but has no
Palamedes Magic Containers app. The intended Remix origins currently resolve
to the existing external demo server and fail TLS negotiation. DNS resolution
alone does not establish an active proxy route or certificate. Create explicit
Remix records pointing to the new Bunny endpoints; preserve the existing
wildcards serving the other frameworks.

| Endpoint          | Container port | Custom hostnames                                                                                                                      |
| ----------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `remix-cookie`    | 4060           | `remix-cookie.examples.palamedes.dev`                                                                                                 |
| `remix-route`     | 4061           | `remix-route.examples.palamedes.dev`                                                                                                  |
| `remix-subdomain` | 4062           | `en.remix-subdomain.examples.palamedes.dev`, `de.remix-subdomain.examples.palamedes.dev`, `es.remix-subdomain.examples.palamedes.dev` |
| `remix-tld`       | 4063           | `remix.examples.palamedes-i18n.com`, `.de`, `.es`, `.fr`                                                                              |

Each hostname must reach its endpoint with the original request Host. Disable
HTML caching for the first rollout, including responses that negotiate a cookie
or Accept-Language. Do not cache nonce-bearing documents or mix locale hosts.
Retain the app's CSP and Vary headers. Test the actual Bunny origin Host setting
before switching DNS; the subdomain and TLD apps derive their locale from it.
Review auto-detected ports in the Bunny deployment form: keep only CDN HTTP
endpoints for 4060–4063 and remove the other image ports and any Anycast entries.
DNS wildcards and TLS wildcard certificates have different matching rules;
individual locale records and certificates are sufficient for these three
subdomain hosts.

Use the four HTTPS browser commands above after DNS and TLS are ready. Record
the Bunny app/endpoint identifiers, image digest, Git revision, all nine origins,
verification date, and all four browser results in #1261. Keep the previous DNS
targets and image digest for rollback. Update live matrix entries and public
links only after this evidence passes; #1261 remains open until then.

Bunny bills consumed CPU time and RAM while a replica is running. One region
with one replica avoids multiplying idle costs. At the published rates, 512 MB
of average billed RAM for 744 hours costs about $1.86 and 1 GB about $3.72,
plus CPU, traffic, and Bunny's workload-dependent system memory overhead. These
are sizing scenarios, not measured usage or a spending cap. Measure the four-server runtime before choosing a memory limit.
See [Bunny pricing](https://bunny.net/docs/magic-containers/pricing) and
[deployment settings](https://bunny.net/docs/magic-containers/deploy).

## Live Reference URLs

These URLs describe the intended public reference shape — six frameworks, each in
four locale strategies. Switch language in a reachable demo and watch copy,
plural seat counts, currency, and dates change together. The demos are grouped by
framework below, with every locale-specific URL linked directly where public
hosting exists. Next.js, TanStack Start, Solid, Waku, and React Router have live
public demos for all four strategies. Remix v3 rows link to source because that
stable integration is currently a local/CI proof surface.

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
(`de.nextjs-subdomain.examples.palamedes.dev` renders German). Check DNS and
TLS coverage separately: a certificate for `*.examples.palamedes.dev` does not
cover these deeper locale hosts. Explicit per-example DNS wildcards keep the
routing records clear:

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
live yet; its Bunny deployment targets are listed above.

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
verification path, not by public TLD deployment. The Bunny rollout above adds
only the Remix hosts.

## Container Image Publication

The repository publishes the examples image through
[`publish-examples-container.yml`](../.github/workflows/publish-examples-container.yml).
The workflow runs on image-relevant pushes to `main` and manual dispatches.
It is independent of package release authorization; only `main` can publish. Branch dispatches
require `dry_run` and build/test without publishing.
It builds the workspace and complete example matrix, then pushes
`ghcr.io/sebastian-software/palamedes-examples` with `latest` and commit-SHA
tags.

The image starts every example through
[`scripts/container/start-all.mjs`](../scripts/container/start-all.mjs). Fixed
ports come from the shared example matrix. Reverse-proxy routing and deployment
of a selected image tag are intentionally external to this repository.
