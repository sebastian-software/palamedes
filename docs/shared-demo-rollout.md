# Shared Bunny Demo Rollout

This runbook prepares all 25 matrix examples for one Bunny Magic Containers app.
It does not claim that the app, DNS records, or final HTTPS proofs already exist.
The Remix acceptance issue is [#1261](https://github.com/sebastian-software/palamedes/issues/1261).
The publishing prerequisite is [#1283](https://github.com/sebastian-software/palamedes/pull/1283).

## Target and cost evidence

Use one app named `palamedes-demos`, one Frankfurt region, and minimum and maximum
replicas both set to 1. Leave `PALAMEDES_EXAMPLES` unset to start all 25 servers.
Do not add persistent volumes or an Anycast IP. This is a shared failure domain:
the supervisor stops all servers when one exits unexpectedly. Keep that restart
policy rather than silently serving an incomplete matrix.

The [October 20 measurement](https://github.com/sebastian-software/palamedes/actions/runs/39337727324)
ran the production source from `62cf1e9a`, with all 25 servers in one Linux amd64
container. All 25 browser contracts and 248 smoke requests passed. Warm idle RAM
was 3.466 GiB, raw cgroup peak 3.982 GiB, and idle CPU averaged 0.000158 cores.
There was no swap or OOM event. This was an eight-minute diagnostic run, not a
long-term or Bunny billing measurement; the readiness changes require a fresh
runtime check before deployment.

At Bunny's published RAM and CPU rates, that idle footprint estimates $13.02 per
31 days; adding 1 GiB of assumed RAM reserve gives $16.74. Use $20 plus traffic as
an initial planning budget, not a hard cap. Bunny adds workload-dependent system
memory overhead. Rolling updates can briefly overlap old and new instances.
Review actual billed RAM, CPU, traffic, and restart counts after the first day
and week. Revisit the design if the steady compute forecast exceeds $20/month,
RAM keeps increasing after warmup, or restarts recur. Do not automatically stop
all public demos on an estimate. The 4 GiB trial limit is too close to the
measured peak; use a regular account.

Sources: [pricing](https://bunny.net/docs/magic-containers/pricing),
[limits](https://bunny.net/docs/magic-containers/limits), and
[replica settings](https://bunny.net/docs/magic-containers/autoscaling).

## Repository preparation

The publisher builds Linux amd64, starts all 25 servers, and executes
`scripts/container/verify-all.mjs` before pushing tags. It reuses every matrix
smoke contract, including redirect and locale assertions, and probes Vite's HTML
entry. Package publication remains independently held.

`node scripts/print-demo-deployment.mjs` emits the complete deployment inventory:
25 endpoint names and ports, 55 hostnames, canonical HTTPS entry origins, and the
internal health port. `scripts/example-matrix.mjs` owns identities and ports;
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

Vite MDX uses 4070 and the intended new hostname
`vite-mdx.examples.palamedes.dev`. Each family has one cookie hostname, one route
hostname, three subdomain locale hosts, and four TLD hosts. Preserve the existing
public URL shapes; do not redirect them to provider-generated origins.

## Provisioning prerequisites

1. Merge the reviewed preparation, publish from `main`, and retain the Git SHA,
   publishing run URL, and immutable `sha256:` digest from its summary. Do not
   deploy a branch dry run or infer image identity from `latest`.
2. Confirm account billing, regular runtime limits, Frankfurt availability, and
   that 25 CDN endpoints with 55 custom hosts fit the account's configuration.
   If they do not, stop and revise the endpoint topology before provisioning.
3. Export the current DNS record values and TTLs for all affected zones and
   verify the existing server can still serve the five current framework
   families. Preserve that infrastructure until migration is accepted.
4. Create the app using that verified image. Add exactly the 25 HTTP CDN
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

1. Start the complete container and verify internal readiness and logs.
2. Move the nine Remix hostnames first. Run the four Remix hosted contracts.
3. Move each existing framework family as a batch, testing its four strategies
   before moving the next family. Publish Vite after its own DNS/TLS are ready.
4. Run the complete hosted verification, then observe actual usage and errors
   for at least 24 hours before retiring any previous demo routes.

Run a selected batch without builds, local process startup, or port cleanup:

```sh
node scripts/verify-hosted-examples.mjs remix-cookie remix-route remix-subdomain remix-tld
# All 25 demos:
node scripts/verify-hosted-examples.mjs
# One final origin:
pnpm verify:examples:browser -- --id nextjs-subdomain --base-url https://en.nextjs-subdomain.examples.palamedes.dev
```

Install dependencies and Playwright Chromium on the verification machine first.
External mode requires a single known matrix ID and a final HTTPS origin without
path, query, credentials, or fragment. Host strategies enter at `en.` or `.com`.
HTTP loopback remains available for cookie/route rehearsal. Browser tests retain
normal TLS validation; local TLD resolver mappings do not replace public hosts.

The hosted batch checks uncached-by-client document language repeatedly across
locale changes, then executes each existing browser contract. It writes one log
per example and `hosted-verification/receipt.json`, including all requested
origins and document results. The route-host-mismatch alias remains a local
contract because the public route hostname has no required locale-mapped alias;
route authority, browser negotiation, switching, and reloads remain tested.

## Controlled image updates

Create a GitHub environment named `bunny-demos`, restrict it to `main`, and
configure a deployment reviewer. Add:

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
  digest, compare the OCI source revision, and smoke-test all 25 servers plus
  readiness. No Bunny credentials or mutation.
- `deploy`: repeat image verification, pass the environment gate, record the
  previous image, and submit the pinned update. Submission is not confirmation
  that the new instance serves traffic.
- `verify-hosts`: after Bunny reports the new image fully rolled out, repeat the
  image check and run all final HTTPS browser/document checks. Keep the Bunny
  rollout evidence with the receipt; a public browser run alone cannot establish
  which image answered during an overlapping update.

Retain the workflow artifacts and deployment receipt in the acceptance record.
The workflow has no push trigger, does not provision apps or modify DNS, and does
not automatically deploy on image publication. First provisioning remains a
separate operation. The updater follows the API contract used by Bunny's
[official integration](https://bunny.net/docs/magic-containers/deploy-with-github-actions).

For rollback, dispatch `deploy` with the previously verified revision and digest,
then check rollout health and run `verify-hosts`. If the preceding image predates
this runbook's health/smoke scripts, restore its saved image configuration through
Bunny directly and use the appropriate earlier checks. During initial migration,
restore each affected DNS batch to its saved old values if needed. Do not delete
the old server or unrelated routes as part of rollback or migration cleanup.

## Acceptance and remaining external work

Before advertising Remix as live, retain the image identity, Bunny app/endpoint
IDs, all nine Remix origins, successful browser receipts, TLS/Host/cache evidence,
and verification date in #1261. Update `docs/demo-deployments.md`, the site matrix
and tests, framework pages, example documentation, and README sources together;
regenerate managed outputs. Other frameworks keep their existing public links.

Before calling the full migration complete, require all 25 hosted contracts,
all 55 hostname/TLS checks, successful recovery and rollback rehearsal, no locale
cache leakage, and a stable first-day resource/billing observation. Keep the
public matrix unchanged until its own hosted evidence passes.

Still external: app provisioning, account/budget authorization, environment
credentials, custom host/TLS/cache settings, DNS changes, and live acceptance.
Existing Helium access can cover the Bunny UI setup; old server access is needed
only for recovery verification or subsequent route retirement. This preparation
neither enables package publication nor retires the old server.
