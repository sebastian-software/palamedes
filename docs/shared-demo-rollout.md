# Shared Bunny Demo Rollout

The shared Bunny Magic Containers app serves 41 demos: ten framework families
across four locale strategies, plus Vite MDX. Its inventory contains 101 public
HTTPS hosts. [Demo Deployments](./demo-deployments.md) records the pinned image,
source, active rollout, live URLs, and public acceptance receipts. Historical
migration work is recorded in [#1261](https://github.com/sebastian-software/palamedes/issues/1261).

## Provisioned configuration

- App `palamedes-demos` (`5DAx1z3T6GFLvSa`), container `palamedes-examples`,
  one Frankfurt (`DE`) region, static provisioning, replicas fixed at 1.
- Regular runtime limits; no persistent volumes or Anycast IP. Exactly 41 HTTP
  CDN endpoints forward the fixed backend ports below. Port 4080 stays private.
- Startup, readiness, and liveness use HTTP GET `:4080/ready`. Startup allows
  24 failures at five-second intervals with a five-second timeout. Readiness
  starts after ten seconds; liveness starts after 120 seconds with five allowed
  failures at 30-second intervals. Both cold image rollouts reached active.
- All 101 custom hosts have TLS and forced HTTPS. Explicit CNAMEs point to their
  matching endpoints; old wildcards, unrelated DNS, and the old server remain.
- Every endpoint preserves the original Host, forwards cookies, and bypasses
  CDN caching (`CacheControlMaxAgeOverride=0`,
  `CacheControlPublicMaxAgeOverride=-1`, `DisableCookies=false`).
- GitHub environment `bunny-demos` is restricted to `main` with a deployment
  reviewer. Its app/container variables and organization secret `BUNNY_API_KEY`
  are configured and were exercised by the successful deployment workflow.

The rollout and public functional checks are complete. First-day/week resource,
restart, and billing observation remains open. Keep the old server available
until operational acceptance and recovery verification; do not treat a short
successful rollout as a long-term stability measurement.

## Capacity and cost evidence

Use one app named `palamedes-demos`, one Frankfurt region, and minimum and maximum
replicas both set to 1. Leave `PALAMEDES_EXAMPLES` unset to start all 41 servers.
Do not add persistent volumes or an Anycast IP. This is a shared failure domain:
the supervisor stops all servers when one exits unexpectedly. Keep that restart
policy rather than silently serving an incomplete matrix.

The [October 20 measurement](https://github.com/sebastian-software/palamedes/actions/runs/39337727324)
ran the production source from `62cf1e9a`, with all 25 servers in one Linux amd64
container. All 25 browser contracts and 248 smoke requests passed. Warm idle RAM
was 3.466 GiB, raw cgroup peak 3.982 GiB, and idle CPU averaged 0.000158 cores.
There was no swap or OOM event. This was an eight-minute diagnostic run, not a
long-term or Bunny billing measurement. Keep this as historical evidence for the
25-server deployment; it does not measure the expanded 41-server deployment.

The [41-demo publisher](https://github.com/sebastian-software/palamedes/actions/runs/39848523010)
recorded 6.624 GiB during its all-server smoke test. This is one GitHub runner
snapshot, not Bunny idle RAM, peak memory, or billed usage. The previous $20 plus
traffic planning budget came from the smaller 25-server measurement and must be
reassessed using the expanded app's actual RAM, CPU, traffic, and restart counts.
Rolling updates can briefly overlap old and new instances. Use the regular
account's runtime limits; do not use the 4 GiB trial limit for this image.

Sources: [pricing](https://bunny.net/docs/magic-containers/pricing),
[limits](https://bunny.net/docs/magic-containers/limits), and
[replica settings](https://bunny.net/docs/magic-containers/autoscaling).

## Repository preparation

The publisher builds Linux amd64, starts all 41 servers, and executes
`scripts/container/verify-all.mjs` before pushing tags. It reuses every matrix
smoke contract, including redirect and locale assertions, and probes Vite's HTML
entry using its public Host header. Vite's preview configuration explicitly
allows `vite-mdx.examples.palamedes.dev`; keep host validation enabled. Package
publication remains independently held.

The hydrated framework demos format the Berlin event in `Europe/Berlin` on the
server and expose the same policy through `data-palamedes-time-zone` for client
bootstrap. Browser verification uses `America/Los_Angeles` so matching local host
zones cannot hide date/time hydration errors.

`node scripts/print-demo-deployment.mjs` emits the complete deployment inventory:
41 endpoint names and ports, 101 hostnames, canonical HTTPS entry origins, and the
internal health port. `scripts/example-matrix.mjs` and
`scripts/component-demos.mjs` own identities and ports;
`scripts/demo-deployment.mjs` owns the intended domain mapping. This inventory is
input for provisioning, not an automatic Bunny/DNS mutation.

| Family         | Cookie | Route | Subdomain | TLD  |
| -------------- | ------ | ----- | --------- | ---- |
| Next.js        | 4010   | 4011  | 4012      | 4013 |
| TanStack Start | 4020   | 4021  | 4022      | 4023 |
| Waku           | 4030   | 4031  | 4032      | 4033 |
| React Router   | 4040   | 4041  | 4042      | 4043 |
| Solid          | 4050   | 4051  | 4052      | 4053 |
| Remix          | 4060   | 4061  | 4062      | 4063 |
| Vue + Vite     | 4090   | 4091  | 4092      | 4093 |
| Nuxt           | 4100   | 4101  | 4102      | 4103 |
| Svelte + Vite  | 4110   | 4111  | 4112      | 4113 |
| SvelteKit      | 4120   | 4121  | 4122      | 4123 |

Vite MDX uses 4070 and the hostname
`vite-mdx.examples.palamedes.dev`. Each family has one cookie hostname, one route
hostname, four subdomain locale hosts, and four TLD hosts. Preserve the existing
public URL shapes; do not redirect them to provider-generated origins.

## Reprovisioning prerequisites

1. Merge the reviewed preparation, publish from `main`, and retain the Git SHA,
   publishing run URL, and immutable `sha256:` digest from its summary. Do not
   deploy a branch dry run or infer image identity from `latest`.
2. Confirm account billing, regular runtime limits, Frankfurt availability, and
   that 41 CDN endpoints with 101 custom hosts fit the account's configuration.
   If they do not, stop and revise the endpoint topology before provisioning.
3. Export the current DNS record values and TTLs for all affected zones and
   verify the existing deployment can still serve its current framework
   families. Preserve that infrastructure until migration is accepted.
4. Create the app using that verified image. Add exactly the 41 HTTP CDN
   endpoints from the inventory. Review auto-detected image ports: **4080 is an
   internal health port and must not get a public CDN or Anycast endpoint**.
5. Configure startup and readiness as HTTP GET `:4080/ready`. It reports 503
   until every selected backend responds, and on backend failure or shutdown.
   Use an initial startup window of 120 seconds and a 5-second probe timeout,
   then validate the actual Bunny settings against cold startup. Use a
   conservative liveness failure threshold to avoid restart loops from one
   transient backend delay. Test both cold startup and recovery before DNS.

Bunny supports [HTTP health checks](https://bunny.net/docs/magic-containers/health-checks)
and [multiple HTTP endpoints](https://bunny.net/docs/magic-containers/endpoints).
The app itself exposes plain HTTP; terminate public TLS at Bunny.

## React Router action origins

React Router validates an action request against its public origin. The examples
use the documented `allowedActionOrigins` setting with only their exact public
demo hosts because TLS terminates at the CDN and the application hop is HTTP.
Keep these lists aligned with the deployment inventory when changing hosts.
Do not disable origin validation or use a catch-all pattern. Browser verification
replays public HTTPS-origin POSTs over the local HTTP hop and requires foreign
origins to return HTTP 400; hosted verification repeats both assertions.

## Host forwarding, DNS, and caching

Register every custom hostname and its certificate on the correct endpoint.
Deeper locale subdomains require their own TLS coverage; a certificate for
`*.examples.palamedes.dev` does not cover `en.remix-subdomain.examples.palamedes.dev`.
Preserve the incoming Host and public HTTPS scheme through the proxy; do not
replace locale hosts with the Bunny origin hostname. Verify this through actual
locale output and generated navigation links before expanding the rollout.

Disable CDN caching of HTML and dynamic framework responses for the initial
rollout, including requests with Cookie or Accept-Language, locale writes,
redirects, and nonce-bearing documents. Preserve CSP, Vary, Set-Cookie, and the
application's static-asset cache headers. Do not enable broad extensionless
response caching or HTML rewriting. Any later HTML caching is a separate change
with host/cookie/language isolation and nonce-safety evidence.

Lower the relevant DNS TTLs ahead of the migration window and wait out the old
TTL. Add explicit records pointing to the corresponding Bunny endpoints rather
than replacing shared wildcards for unmigrated apps. Retain the old record values.
The default Bunny hostname cannot prove subdomain or TLD locale selection.

## Rollout and verification

1. Start the complete verified container and confirm readiness, the active pod
   image digest, and that previous pods have retired.
2. Run `inspect-hosting` and `plan-hosts`. Check existing endpoint ports and the
   exact DNS targets before the first write.
3. Run `provision-hosts` for the 16 component endpoints. It prepares all 40 DNS
   records before waiting for their propagation together, then enables TLS and
   forced HTTPS. Keep the partial receipt if any step fails; retries reuse exact
   matching endpoints and records.
4. Run all 41 public browser/document contracts and all 101 HTTP-to-HTTPS,
   DNS, and TLS checks. Keep receipts with the image identity before advertising
   new links. Observe actual usage and restarts before retiring legacy routes.

Run a selected batch without builds, local process startup, or port cleanup:

```sh
node scripts/verify-hosted-examples.mjs remix-cookie remix-route remix-subdomain remix-tld
# All 41 demos:
node scripts/verify-hosted-examples.mjs
# One final origin:
pnpm verify:examples:browser -- --id nextjs-subdomain --base-url https://en.nextjs-subdomain.examples.palamedes.dev
```

Install dependencies and Playwright Chromium on the verification machine first.
External mode requires a single known matrix ID and a final HTTPS origin without
path, query, credentials, or fragment. Host strategies enter at `en.` or `.com`.
HTTP loopback remains available for cookie/route rehearsal. Browser tests retain
normal TLS validation; local TLD resolver mappings do not replace public hosts.

The hosted batch checks all 101 HTTP-to-HTTPS redirects and requires each to
preserve its public hostname. It then checks that server-rendered route-entry
redirects preserve the public HTTPS origin, including when TLS terminates before
the application. It checks uncached-by-client document language repeatedly
across locale changes, then executes each browser contract. The component
contracts also verify the actual framework identity, all four languages, locale authority,
and full-document language switches. Nuxt and SvelteKit additionally prove
server HTML without JavaScript and same-locale navigation without a new document.
It writes one log per example and `hosted-verification/receipt.json`, including
all requested origins and document results. The route-host-mismatch alias remains a local
contract because the public route hostname has no required locale-mapped alias;
route authority, browser negotiation, switching, and reloads remain tested.

## Controlled image updates

The existing GitHub environment `bunny-demos` restricts updates to `main` and
requires a deployment reviewer. When reprovisioning, configure:

- Organization secret `BUNNY_API_KEY`, with access granted to this repository.
  The deploy job maps it to the script's `BUNNYNET_API_KEY` environment variable;
  no duplicate environment secret is needed. Never put the key in a PR or chat.
- Environment variables `BUNNY_DEMO_APP_ID` and `BUNNY_DEMO_CONTAINER`.

The documented Bunny update API requires account-level credentials. Limit who
can dispatch/review this environment; verification jobs do not receive the key.
The updater only modifies the selected container image and records the prior
image fields, never environment secrets or the complete app configuration.
The update changes only the image tag and digest. Bunny stores the registry,
namespace, and image name separately; replacing the image name with a full
registry path breaks image pulls even when the update API accepts the request.

Use the **Deploy Examples** workflow on `main` with the exact revision and digest:

- `verify-image` (default): validate SHA/digest syntax and main ancestry, pull by
  digest, compare the OCI source revision, and smoke-test all 41 servers plus
  readiness. No Bunny credentials or mutation.
- `deploy`: repeat image verification, pass the environment gate, record the
  previous image, and submit the pinned update. Submission is not confirmation
  that the new instance serves traffic.
- `inspect-hosting`: pass the environment gate and save a read-only, sanitized
  inventory of endpoints, DNS, CDN settings, and running pods. It never saves
  environment variables, API keys, registry credentials, or certificate keys.
- `plan-hosts`: repeat image verification and review the component endpoint/DNS
  plan without writes. Confirm the active pod digest before provisioning.
- `provision-hosts`: repeat verification, pass the environment gate, require all
  pods ready on the pinned image, and append the 16 component endpoints. It
  preserves existing endpoint configuration, adds 40 explicit CNAMEs, registers
  certificates, and forces HTTPS. Conflicting DNS targets stop the operation.
  Retain its receipt; public acceptance is a separate step.
- `verify-hosts`: after Bunny reports the new image fully rolled out, repeat the
  image check and run all final HTTPS browser/document checks. Keep the Bunny
  rollout evidence with the receipt; a public browser run alone cannot establish
  which image answered during an overlapping update.

Retain the workflow artifacts and deployment receipt in the acceptance record.
The workflow has no push trigger and does not automatically deploy on image
publication. Its separate component-host operations append only the 16 known
Vue, Nuxt, Svelte, and SvelteKit endpoints and their 40 exact hosts to the existing
app. They do not recreate the app or replace unrelated DNS records. The updater
follows the API contract used by Bunny's
[official integration](https://bunny.net/docs/magic-containers/deploy-with-github-actions).

For rollback, dispatch `deploy` with the previously verified revision and digest,
then check rollout health and run `verify-hosts`. If the preceding image predates
this runbook's health/smoke scripts, restore its saved image configuration through
Bunny directly and use the appropriate earlier checks. During initial migration,
restore each affected DNS batch to its saved old values if needed. Do not delete
the old server or unrelated routes as part of rollback or migration cleanup.

The saved previous image (`99cb527b…`, digest `f626d067…`) contains the original
25 demos. Restoring it preserves those integrations but does not serve the 16
new component ports. In that case, verify the original 25 contracts and withdraw
the component links until a verified 41-demo image is active again. Retain the
first accepted 41-demo digest as the complete-matrix baseline for later updates.

## Acceptance and remaining external work

Before advertising a new framework as live, retain the image identity, Bunny
app/endpoint IDs, all ten hosts across its four strategies, successful browser
receipts, TLS/Host/cache evidence, and verification date. Keep rollout history
in #1261. Update `docs/demo-deployments.md`, the site matrix and tests, framework
pages, example documentation, and README sources together; regenerate managed
outputs. Preserve existing public links while adding the new framework families.

Before calling the expanded matrix complete, require all 41 hosted contracts,
all 101 hostname/TLS checks, successful recovery and rollback rehearsal, no locale
cache leakage, and a stable first-day resource/billing observation. Keep the
public matrix unchanged until its own hosted evidence passes.

Provisioning, deployment credentials, custom host/TLS/cache settings, DNS
migration, and the first full live functional acceptance are complete. No
additional account access is needed for controlled image updates. Still open:

- Observe actual RAM, CPU, traffic, billing, and restart behavior after the first
  day and week. Reassess the earlier 25-server budget for the expanded app.
- Retain a durable `verify-hosts` workflow receipt with the acceptance record;
  publish the matching documentation and check deployed matrix navigation before
  closing #1261.
- Verify recovery and the observation window before retiring legacy routes.
  Old server access is needed only for that later retirement or legacy recovery.

This rollout neither enables package publication nor retires the old server.
