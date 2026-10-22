# Demo Deployments

The live deployment contains 41 demos on one Bunny Magic Containers app:
ten framework families × four locale strategies, plus Vite MDX. Its 101 custom
HTTPS hostnames preserve the public URL shapes. The image identity, rollout,
and public acceptance receipts are recorded below and in
[the framework-demo rollout](https://github.com/sebastian-software/palamedes/pull/1326).

The [shared rollout runbook](./shared-demo-rollout.md) owns endpoint ports,
health checks, image updates, cache settings, rollback, and resource observation.
The public URLs below are the live reference surface; local and CI contracts
remain independently reproducible.

## Component Framework Expansion

Vue + Vite, Nuxt, Svelte + Vite, and SvelteKit now share the same booking
application across cookie, route, subdomain, and TLD locale selection. Each
framework builds once and runs four production instances. The container inventory
in `scripts/component-demos.mjs` adds 16 demos on ports 4090–4093, 4100–4103,
4110–4113, and 4120–4123. Together with the existing matrix, the image contains
41 demos; the complete deployment manifest describes 101 HTTPS hostnames.

Vue and Svelte render in the browser. Their blocking locale bootstrap runs
before translated modules load. Nuxt and SvelteKit resolve the locale per server
request and preserve it through hydration and lazy page navigation. A language
switch always navigates to a new document. Cookie selection uses an explicit
`locale` cookie before browser preferences; path, subdomain, and TLD selection
are authoritative. Standalone local spikes retain their `?locale=de` entry.

After `pnpm build`, build the four shared apps and exercise all 16 variants:

```sh
node scripts/build-component-demos.mjs
node scripts/verify-component-demos.mjs --local
```

The verifier checks all four languages, locale authority, language switches and
reloads, ticket interaction, and lazy catalogs. For Nuxt and SvelteKit it also
checks server HTML without JavaScript and same-locale detail navigation. CI runs
this contract alongside the original framework proof suites. The image publisher
smoke-tests all 41 running servers before publication.

The gated `Deploy Examples` workflow separates read-only inventory and planning
from image updates and endpoint provisioning. Its sanitized receipts exclude
API credentials, environment variables, registry credentials, and certificate
keys. Public browser acceptance follows the completed rollout.

## Deployment Evidence

| Evidence          | Verified value                                                                                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source revision   | `a47efd3d416755f98de7ce8474a1b30efa23d459`                                                                                                                                   |
| Verifier contract | [HTTP redirects, framework identity, and hosted browser contracts](https://github.com/sebastian-software/palamedes/commit/f00bf93e3fcefb689e05421b12de9d39880bae8b)          |
| Image             | `ghcr.io/sebastian-software/palamedes-examples@sha256:925e3f3c62feb135deacd2b9a6772ecec375850f7c403a347bc299f71f0aa429`                                                      |
| Publisher         | [Successful build, all-41 smoke test, and publication](https://github.com/sebastian-software/palamedes/actions/runs/39848523010)                                             |
| Image update      | [Pinned image update and saved previous image](https://github.com/sebastian-software/palamedes/actions/runs/39850579025)                                                     |
| Active rollout    | [Ready Frankfurt pod on the new digest, zero restarts](https://github.com/sebastian-software/palamedes/actions/runs/39851566668)                                             |
| Runtime           | `palamedes-demos`, app `5DAx1z3T6GFLvSa`; one active Frankfurt instance, 41 HTTP CDN endpoints; readiness port 4080 remains private                                          |
| Public acceptance | [41 hosted contracts and 101 hostname checks: receipts and completion time](https://github.com/sebastian-software/palamedes/pull/1326)                                       |
| Previous image    | Source `99cb527b16e7874735512fe96926cbe89d4d5ca7`, digest `sha256:f626d067ba1224af62cbdc326200d4a7c7533b4bb17d9f404c3304af5fcb6101`; saved by the image updater for rollback |

Bunny reported the final image active before browser verification began; the
previous instance had retired. The browser batch checks repeated SSR language
selection, switching, redirects, reloads, and each example's interaction contract.
Remix additionally proves rich messages, document and standalone Frames, initial
and lazy catalog failures, and recovery under CSP. React Router's ten exact
HTTPS action origins accept proxy requests while foreign origins remain rejected.
Earlier Berlin and UTC browser reproductions of the reported React Router client crash
also passed without page, console, or hydration errors. The shared browser suite
uses `America/Los_Angeles` to detect server/browser time-zone disagreement.

Public acceptance runs the verifier contract above against the pinned runtime
image, with separate receipts for the original 25 demos and the 16 component
demos. French SSR requests are included for every server
strategy, followed by a repeated language to detect CDN locale leakage. Each
Remix locale/failure pair has its own recovery test with the unchanged default
time limit; all 32 lazy-catalog recovery scenarios passed across the four
strategies. The earlier aggregate test exceeded its shared budget over public
HTTPS. This test split changes no runtime behavior or recovery assertions.

Retain `hosted-verification/receipt.json` and per-example logs when repeating a
batch. The cookie read checks observe real Chromium response headers, including
`Set-Cookie`, without replacing the browser transport. A successful build or
image-update submission alone does not establish live acceptance.

First-day and first-week resource, restart, and billing observations remain open.
Keep the old server and saved DNS values available until operational acceptance;
the package release hold is unchanged. Rollout history is recorded in [#1261](https://github.com/sebastian-software/palamedes/issues/1261).

## Repeat Verification

```sh
pnpm build:examples
pnpm verify:examples
# Final public hosts; requires dependencies and Playwright Chromium:
node scripts/verify-hosted-examples.mjs
# A selected hosted batch, without local builds or servers:
node scripts/verify-hosted-examples.mjs remix-cookie remix-route remix-subdomain remix-tld
```

External mode requires known matrix IDs and canonical HTTPS origins without a
path, query, credentials, or fragment. Route mode adds locale paths itself;
subdomain mode starts at `en.` and TLD mode at `.com`. Chromium retains normal
TLS validation. Loopback and simulated local hosts do not replace public proof.
The controlled `verify-hosts` workflow additionally checks the immutable image
and retains hosted logs as artifacts; see the runbook for the deployment gate.

Remix remains a Preview adapter for the exact tested upstream Remix 3.0.0
contract. Completing public hosting does not change its compatibility or SemVer
tier; see [Stability and Versioning](./stability.md).

## Live Reference URLs

Switch language to see copy, plural seat counts, currency, and dates change
together. Each of the ten framework families has these four strategies:

- **cookie** — one host; `Accept-Language` negotiates the initial locale and an
  explicit user choice persists it in a cookie.
- **route** — one host; the first path segment is `/en`, `/de`, `/es`, or `/fr`.
- **subdomain** — the leftmost label is `en`, `de`, `es`, or `fr`.
- **tld** — `.com` explicitly maps to English; `.de`, `.es`, and `.fr` select
  German, Spanish, and French.

### Next.js

| Strategy  | Live demos                                                                                                                                                                                                                                |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cookie    | [nextjs-cookie.examples.palamedes.dev](https://nextjs-cookie.examples.palamedes.dev)                                                                                                                                                      |
| route     | [en](https://nextjs-route.examples.palamedes.dev/en) · [de](https://nextjs-route.examples.palamedes.dev/de) · [es](https://nextjs-route.examples.palamedes.dev/es) · [fr](https://nextjs-route.examples.palamedes.dev/fr)                 |
| subdomain | [en](https://en.nextjs-subdomain.examples.palamedes.dev) · [de](https://de.nextjs-subdomain.examples.palamedes.dev) · [es](https://es.nextjs-subdomain.examples.palamedes.dev) · [fr](https://fr.nextjs-subdomain.examples.palamedes.dev) |
| tld       | [en](https://nextjs.examples.palamedes-i18n.com) · [de](https://nextjs.examples.palamedes-i18n.de) · [es](https://nextjs.examples.palamedes-i18n.es) · [fr](https://nextjs.examples.palamedes-i18n.fr)                                    |

### TanStack Start

| Strategy  | Live demos                                                                                                                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cookie    | [tanstack-cookie.examples.palamedes.dev](https://tanstack-cookie.examples.palamedes.dev)                                                                                                                                                          |
| route     | [en](https://tanstack-route.examples.palamedes.dev/en) · [de](https://tanstack-route.examples.palamedes.dev/de) · [es](https://tanstack-route.examples.palamedes.dev/es) · [fr](https://tanstack-route.examples.palamedes.dev/fr)                 |
| subdomain | [en](https://en.tanstack-subdomain.examples.palamedes.dev) · [de](https://de.tanstack-subdomain.examples.palamedes.dev) · [es](https://es.tanstack-subdomain.examples.palamedes.dev) · [fr](https://fr.tanstack-subdomain.examples.palamedes.dev) |
| tld       | [en](https://tanstack.examples.palamedes-i18n.com) · [de](https://tanstack.examples.palamedes-i18n.de) · [es](https://tanstack.examples.palamedes-i18n.es) · [fr](https://tanstack.examples.palamedes-i18n.fr)                                    |

### Waku

| Strategy  | Live demos                                                                                                                                                                                                                        |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cookie    | [waku-cookie.examples.palamedes.dev](https://waku-cookie.examples.palamedes.dev)                                                                                                                                                  |
| route     | [en](https://waku-route.examples.palamedes.dev/en) · [de](https://waku-route.examples.palamedes.dev/de) · [es](https://waku-route.examples.palamedes.dev/es) · [fr](https://waku-route.examples.palamedes.dev/fr)                 |
| subdomain | [en](https://en.waku-subdomain.examples.palamedes.dev) · [de](https://de.waku-subdomain.examples.palamedes.dev) · [es](https://es.waku-subdomain.examples.palamedes.dev) · [fr](https://fr.waku-subdomain.examples.palamedes.dev) |
| tld       | [en](https://waku.examples.palamedes-i18n.com) · [de](https://waku.examples.palamedes-i18n.de) · [es](https://waku.examples.palamedes-i18n.es) · [fr](https://waku.examples.palamedes-i18n.fr)                                    |

### React Router

| Strategy  | Live demos                                                                                                                                                                                                                                                        |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cookie    | [react-router-cookie.examples.palamedes.dev](https://react-router-cookie.examples.palamedes.dev)                                                                                                                                                                  |
| route     | [en](https://react-router-route.examples.palamedes.dev/en) · [de](https://react-router-route.examples.palamedes.dev/de) · [es](https://react-router-route.examples.palamedes.dev/es) · [fr](https://react-router-route.examples.palamedes.dev/fr)                 |
| subdomain | [en](https://en.react-router-subdomain.examples.palamedes.dev) · [de](https://de.react-router-subdomain.examples.palamedes.dev) · [es](https://es.react-router-subdomain.examples.palamedes.dev) · [fr](https://fr.react-router-subdomain.examples.palamedes.dev) |
| tld       | [en](https://react-router.examples.palamedes-i18n.com) · [de](https://react-router.examples.palamedes-i18n.de) · [es](https://react-router.examples.palamedes-i18n.es) · [fr](https://react-router.examples.palamedes-i18n.fr)                                    |

### Solid

| Strategy  | Live demos                                                                                                                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cookie    | [solid-cookie.examples.palamedes.dev](https://solid-cookie.examples.palamedes.dev)                                                                                                                                                    |
| route     | [en](https://solid-route.examples.palamedes.dev/en) · [de](https://solid-route.examples.palamedes.dev/de) · [es](https://solid-route.examples.palamedes.dev/es) · [fr](https://solid-route.examples.palamedes.dev/fr)                 |
| subdomain | [en](https://en.solid-subdomain.examples.palamedes.dev) · [de](https://de.solid-subdomain.examples.palamedes.dev) · [es](https://es.solid-subdomain.examples.palamedes.dev) · [fr](https://fr.solid-subdomain.examples.palamedes.dev) |
| tld       | [en](https://solid.examples.palamedes-i18n.com) · [de](https://solid.examples.palamedes-i18n.de) · [es](https://solid.examples.palamedes-i18n.es) · [fr](https://solid.examples.palamedes-i18n.fr)                                    |

### Remix

Remix renders the same booking interface through its native UI and asset runtime.
Every strategy preserves its full-stack browser and recovery contract, with
Frames, lazy catalogs, and recovery available in “Behind the scenes.”

| Strategy  | Live demos                                                                                                                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cookie    | [remix-cookie.examples.palamedes.dev](https://remix-cookie.examples.palamedes.dev)                                                                                                                                                    |
| route     | [en](https://remix-route.examples.palamedes.dev/en) · [de](https://remix-route.examples.palamedes.dev/de) · [es](https://remix-route.examples.palamedes.dev/es) · [fr](https://remix-route.examples.palamedes.dev/fr)                 |
| subdomain | [en](https://en.remix-subdomain.examples.palamedes.dev) · [de](https://de.remix-subdomain.examples.palamedes.dev) · [es](https://es.remix-subdomain.examples.palamedes.dev) · [fr](https://fr.remix-subdomain.examples.palamedes.dev) |
| tld       | [en](https://remix.examples.palamedes-i18n.com) · [de](https://remix.examples.palamedes-i18n.de) · [es](https://remix.examples.palamedes-i18n.es) · [fr](https://remix.examples.palamedes-i18n.fr)                                    |

### Vue + Vite

| Strategy  | Live demos                                                                                                                                                                                                                    |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cookie    | [vue-cookie.examples.palamedes.dev](https://vue-cookie.examples.palamedes.dev)                                                                                                                                                |
| route     | [en](https://vue-route.examples.palamedes.dev/en) · [de](https://vue-route.examples.palamedes.dev/de) · [es](https://vue-route.examples.palamedes.dev/es) · [fr](https://vue-route.examples.palamedes.dev/fr)                 |
| subdomain | [en](https://en.vue-subdomain.examples.palamedes.dev) · [de](https://de.vue-subdomain.examples.palamedes.dev) · [es](https://es.vue-subdomain.examples.palamedes.dev) · [fr](https://fr.vue-subdomain.examples.palamedes.dev) |
| tld       | [en](https://vue.examples.palamedes-i18n.com) · [de](https://vue.examples.palamedes-i18n.de) · [es](https://vue.examples.palamedes-i18n.es) · [fr](https://vue.examples.palamedes-i18n.fr)                                    |

### Nuxt

| Strategy  | Live demos                                                                                                                                                                                                                        |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cookie    | [nuxt-cookie.examples.palamedes.dev](https://nuxt-cookie.examples.palamedes.dev)                                                                                                                                                  |
| route     | [en](https://nuxt-route.examples.palamedes.dev/en) · [de](https://nuxt-route.examples.palamedes.dev/de) · [es](https://nuxt-route.examples.palamedes.dev/es) · [fr](https://nuxt-route.examples.palamedes.dev/fr)                 |
| subdomain | [en](https://en.nuxt-subdomain.examples.palamedes.dev) · [de](https://de.nuxt-subdomain.examples.palamedes.dev) · [es](https://es.nuxt-subdomain.examples.palamedes.dev) · [fr](https://fr.nuxt-subdomain.examples.palamedes.dev) |
| tld       | [en](https://nuxt.examples.palamedes-i18n.com) · [de](https://nuxt.examples.palamedes-i18n.de) · [es](https://nuxt.examples.palamedes-i18n.es) · [fr](https://nuxt.examples.palamedes-i18n.fr)                                    |

### Svelte + Vite

| Strategy  | Live demos                                                                                                                                                                                                                                |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cookie    | [svelte-cookie.examples.palamedes.dev](https://svelte-cookie.examples.palamedes.dev)                                                                                                                                                      |
| route     | [en](https://svelte-route.examples.palamedes.dev/en) · [de](https://svelte-route.examples.palamedes.dev/de) · [es](https://svelte-route.examples.palamedes.dev/es) · [fr](https://svelte-route.examples.palamedes.dev/fr)                 |
| subdomain | [en](https://en.svelte-subdomain.examples.palamedes.dev) · [de](https://de.svelte-subdomain.examples.palamedes.dev) · [es](https://es.svelte-subdomain.examples.palamedes.dev) · [fr](https://fr.svelte-subdomain.examples.palamedes.dev) |
| tld       | [en](https://svelte.examples.palamedes-i18n.com) · [de](https://svelte.examples.palamedes-i18n.de) · [es](https://svelte.examples.palamedes-i18n.es) · [fr](https://svelte.examples.palamedes-i18n.fr)                                    |

### SvelteKit

| Strategy  | Live demos                                                                                                                                                                                                                                            |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cookie    | [sveltekit-cookie.examples.palamedes.dev](https://sveltekit-cookie.examples.palamedes.dev)                                                                                                                                                            |
| route     | [en](https://sveltekit-route.examples.palamedes.dev/en) · [de](https://sveltekit-route.examples.palamedes.dev/de) · [es](https://sveltekit-route.examples.palamedes.dev/es) · [fr](https://sveltekit-route.examples.palamedes.dev/fr)                 |
| subdomain | [en](https://en.sveltekit-subdomain.examples.palamedes.dev) · [de](https://de.sveltekit-subdomain.examples.palamedes.dev) · [es](https://es.sveltekit-subdomain.examples.palamedes.dev) · [fr](https://fr.sveltekit-subdomain.examples.palamedes.dev) |
| tld       | [en](https://sveltekit.examples.palamedes-i18n.com) · [de](https://sveltekit.examples.palamedes-i18n.de) · [es](https://sveltekit.examples.palamedes-i18n.es) · [fr](https://sveltekit.examples.palamedes-i18n.fr)                                    |

### Vite MDX

[Open the client-side MDX demo](https://vite-mdx.examples.palamedes.dev).
It uses port 4070 and explicitly allows its public preview hostname. Its linked
MDX handbook supports English, German, and French with document navigation.

## DNS, TLS, Host Forwarding, and Caching

All 101 hosts use explicit CNAME records to their matching Bunny CDN endpoints:
20 cookie/route hosts, 40 locale subdomains, 40 TLD hosts, and Vite MDX. Generate
the exact mapping with `node scripts/print-demo-deployment.mjs`; endpoint ports
and identities come from the example matrix. Existing wildcards and unrelated
DNS records remain intact for rollback and legacy routes.

Each hostname has a certificate on its own endpoint and forces HTTP to HTTPS.
DNS and certificate wildcard matching differ: a certificate for
`*.examples.palamedes.dev` does not cover the deeper locale hosts. All four
subdomain hosts and all four TLD hosts of a strategy reach the same backend
with the original request `Host`, which authoritatively selects the locale.

The initial rollout bypasses CDN response caching and forwards cookies. The
origin Host override is empty. This prevents host, cookie, and Accept-Language
mixing and avoids caching nonce-bearing HTML. Preserve CSP, `Vary`, and
`Set-Cookie`. Any future caching change needs fresh locale-isolation and
nonce-safety evidence; do not enable broad HTML caching as an incidental tweak.

The preserved old target is `s1.sebastian-software.de`. Restore only the affected
explicit records to their saved prior values for a DNS rollback; leave domain
roots, mail, and unrelated routes alone. The nine Next.js records were restored
to the old server and verified before their final Bunny cutover, rehearsing that
rollback path. Do not retire the server during the first-day observation.

## Container Image Publication

[`publish-examples-container.yml`](../.github/workflows/publish-examples-container.yml)
builds Linux amd64, starts and smoke-tests all 41 servers, and publishes
`ghcr.io/sebastian-software/palamedes-examples` on image-relevant `main` pushes or
manual dispatches. Publication is independent of the package release hold.
Branch dispatches require `dry_run` and never publish. Deploy the immutable
pushed digest and recorded source revision rather than inferring identity from
`latest`.

The image starts every example through
[`scripts/container/start-all.mjs`](../scripts/container/start-all.mjs). Leave
`PALAMEDES_EXAMPLES` unset for the shared deployment. Image publication does not
automatically deploy: the reviewed `bunny-demos` environment gates image updates,
and final-host verification follows the completed Bunny rollout.
