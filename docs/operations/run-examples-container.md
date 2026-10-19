# Running all examples together in one container

This document describes how to run all 25 Palamedes matrix example apps together in
**one** Podman container – each on its own fixed port. It builds on the
`Containerfile` in the repo root and the supervisor
`scripts/container/start-all.mjs`.

> A reverse proxy that maps each port to its own domain is intentionally **not**
> part of this setup. The fixed ports exist precisely so such a proxy can be put
> in front later (see "Outlook").

## Prerequisites

- [Podman](https://podman.io/) installed
- Enough resources for two dozen concurrent SSR Node servers (several GB of RAM
  recommended)

A Rust or Node setup on the host is **not** required: the container's build stage
brings Node, pnpm and the Rust toolchain itself and builds the native
`@palamedes/core-node` addon plus all examples inside the image.

## Pull the published image

On image-relevant pushes to `main`, the `Publish Examples Container` workflow
builds and smoke-tests the image before pushing it to GitHub Container Registry. This lane
is independent of the package publication hold. A manual `dry_run` dispatch
builds and tests without pushing, including on a feature branch. Pull a verified
image instead of building:

```bash
podman pull ghcr.io/sebastian-software/palamedes-examples:latest
```

For deployment, use the immutable digest recorded in the workflow summary;
`latest` is a moving convenience tag. The image is built for `linux/amd64`. To
build it yourself (e.g. on arm64), use the next section.

## Build the image

```bash
podman build -f Containerfile -t palamedes-examples .
```

The build is multi-stage:

1. **Build stage** (glibc/Debian): `pnpm install`, `pnpm build` (builds the
   packages including the native addon via `cargo` in release profile) and
   `pnpm build:examples` (builds every app in `examples/`). The `cargo` compilation makes the
   first build noticeably longer.
2. **Runtime stage** (slimmer Debian slim): takes over the finished workspace and
   starts the supervisor. Dev dependencies stay installed because TanStack's
   `vite preview` comes from them; Solid v2 runs Nitro's generated output.

## Start the container

The published ports are generated from the matrix so the run command never drifts
from the ports the servers actually bind:

```bash
podman run $(node ./scripts/container/print-podman-ports.mjs) palamedes-examples
```

Spelled out, this is `-p 4010:4010 -p 4011:4011 … -p 4063:4063 -p 4070:4070`.

- **Init/reaping:** the image ships `tini` as its entrypoint, so reparented child
  processes are reaped cleanly with no extra flag (also works later via
  Compose/Quadlet). An additional `--init` is unnecessary but harmless.
- **Restart behavior:** the supervisor is fail-fast – if one server dies, the
  container exits with an error code. For a long-running demo, start without
  `--rm` and add `--restart=on-failure`; for a one-off foreground run, use `--rm`
  and accept the shutdown.

By default, the supervisor starts all apps from `scripts/example-matrix.mjs`, prefixes their
output with the example id (`[nextjs-cookie] …`), and intentionally exits the
container with an error code as soon as a server dies unexpectedly (fail-fast).
`podman stop` terminates the running servers via forwarded `SIGTERM`.

## Run only the Remix demos

For a low-traffic deployment, keep one image and run only the four Remix servers:

```sh
podman run --name palamedes-remix \
  -e PALAMEDES_EXAMPLES=remix-cookie,remix-route,remix-subdomain,remix-tld \
  -p 127.0.0.1:4060:4060 -p 127.0.0.1:4061:4061 \
  -p 127.0.0.1:4062:4062 -p 127.0.0.1:4063:4063 \
  ghcr.io/sebastian-software/palamedes-examples@sha256:<verified-digest>
```

Replace the digest placeholder with the workflow receipt. The same environment
variable works in Bunny Magic Containers; configure four HTTP endpoints for
ports 4060–4063 instead of host port mappings. Leave `PALAMEDES_EXAMPLES` unset
to start the full matrix. Empty, unknown, and repeated IDs fail before any server
starts. The image still contains all built examples; selecting fewer servers
reduces runtime memory and CPU usage, not image size.

The image publication workflow runs the shared Remix smoke contracts against
this four-server runtime before pushing any tags. It does not prove public TLS,
Host forwarding, caching, or browser behavior; the hosted readiness gate in
[Demo Deployments](../demo-deployments.md) still applies.

## Port overview

| Port | Example                     | Strategy          |
| ---- | --------------------------- | ----------------- |
| 4010 | `nextjs-cookie`             | cookie            |
| 4011 | `nextjs-route`              | route             |
| 4012 | `nextjs-subdomain`          | subdomain         |
| 4013 | `nextjs-tld`                | tld               |
| 4020 | `tanstack-cookie`           | cookie            |
| 4021 | `tanstack-route`            | route             |
| 4022 | `tanstack-subdomain`        | subdomain         |
| 4023 | `tanstack-tld`              | tld               |
| 4030 | `waku-cookie`               | cookie            |
| 4031 | `waku-route`                | route             |
| 4032 | `waku-subdomain`            | subdomain         |
| 4033 | `waku-tld`                  | tld               |
| 4040 | `react-router-cookie`       | cookie            |
| 4041 | `react-router-route`        | route             |
| 4042 | `react-router-subdomain`    | subdomain         |
| 4043 | `react-router-tld`          | tld               |
| 4050 | `solid-cookie`              | cookie            |
| 4051 | `solid-route`               | route             |
| 4052 | `solid-subdomain`           | subdomain         |
| 4053 | `solid-tld`                 | tld               |
| 4060 | `remix-cookie`              | cookie            |
| 4061 | `remix-route`               | route             |
| 4062 | `remix-subdomain`           | subdomain         |
| 4063 | `remix-tld`                 | tld               |
| 4070 | `vite-mdx`                  | client            |
| 4071 | `react-router-rsc` verifier | verifier-assigned |

`scripts/example-matrix.mjs` is the single source of truth for the ports. The
supervisor binds according to it automatically, and the `print-podman-ports.mjs`
call shown above generates the `-p` flags from it too – both follow along with no
manual step. Only the static `EXPOSE` line in the `Containerfile` is purely
informational and must be updated by hand when a port changes.
Port `4071` is assigned only while `verify-react-router-rsc.mjs` runs its
ephemeral verifier server; it is not part of the container supervisor.

## Host binding

All servers listen on `0.0.0.0` inside the container so an external reverse proxy
can reach the published ports. Some frameworks otherwise bind only to
`127.0.0.1`; the supervisor overrides that in a container-specific way, without
touching the example `package.json` files:

- **Solid** (Nitro v3 output): `HOST=0.0.0.0` via environment variable
- **TanStack** (`vite preview`): the hardcoded `--host 127.0.0.1` in the script
  cannot be reliably overridden by an appended flag (Vite's CLI parser collects
  repeated flags into an array), so the supervisor runs `vite preview` directly
  with a single `--host 0.0.0.0`
- **Vite MDX** (`vite preview`): uses the same container-only direct start plan
  with a single `--host 0.0.0.0` and fixed port `4070`

Next.js and React Router already bind `0.0.0.0` / honor `HOST`. Waku is driven via
`HOST=0.0.0.0`; on the first container run, confirm external reachability of
`4030`/`4031` in case `waku start` does not honor `HOST`.

## Check

After startup each port returns a response (cookie strategy on `/`, route
strategy on `/en`):

```bash
curl -sf http://127.0.0.1:4010/ >/dev/null && echo "nextjs-cookie ok"
curl -sf http://127.0.0.1:4011/en >/dev/null && echo "nextjs-route ok"
# … likewise for the remaining ports
```

## Outlook (not part of this setup)

- An external reverse proxy (e.g. Caddy, Traefik or nginx) maps each port to its
  own domain and terminates TLS.
- Optionally run the container as a systemd service via a Podman Quadlet
  `.container` unit.
