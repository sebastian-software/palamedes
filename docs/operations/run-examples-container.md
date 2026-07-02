# Running all examples together in one container

This document describes how to run all ten Palamedes example apps together in
**one** Podman container – each on its own fixed port. It builds on the
`Containerfile` in the repo root and the supervisor
`scripts/container/start-all.mjs`.

> A reverse proxy that maps each port to its own domain is intentionally **not**
> part of this setup. The fixed ports exist precisely so such a proxy can be put
> in front later (see "Outlook").

## Prerequisites

- [Podman](https://podman.io/) installed
- Enough resources for ten concurrent SSR Node servers (several GB of RAM
  recommended)

A Rust or Node setup on the host is **not** required: the container's build stage
brings Node, pnpm and the Rust toolchain itself and builds the native
`@palamedes/core-node` addon plus all examples inside the image.

## Build the image

```bash
podman build -f Containerfile -t palamedes-examples .
```

The build is multi-stage:

1. **Build stage** (glibc/Debian): `pnpm install`, `pnpm build` (builds the
   packages including the native addon via `cargo` in release profile) and
   `pnpm build:examples` (builds all ten apps). The `cargo` compilation makes the
   first build noticeably longer.
2. **Runtime stage** (slimmer Debian slim): takes over the finished workspace and
   starts the supervisor. Dev dependencies stay installed because TanStack's
   `vite preview` and SolidStart's `vinxi start` come from them.

## Start the container

The published ports are generated from the matrix so the run command never drifts
from the ports the servers actually bind:

```bash
podman run --init $(node ./scripts/container/print-podman-ports.mjs) palamedes-examples
```

Spelled out, this is `-p 4010:4010 -p 4011:4011 … -p 4051:4051`.

- `--init` ensures reparented child processes are reaped cleanly. The image also
  ships `tini` as its entrypoint, so reaping works even without `--init` (e.g.
  later via Compose/Quadlet).
- **Restart behavior:** the supervisor is fail-fast – if one server dies, the
  container exits with an error code. For a long-running demo, start without
  `--rm` and add `--restart=on-failure`; for a one-off foreground run, use `--rm`
  and accept the shutdown.

The supervisor starts all apps from `scripts/example-matrix.mjs`, prefixes their
output with the example id (`[nextjs-cookie] …`), and intentionally exits the
container with an error code as soon as a server dies unexpectedly (fail-fast).
`podman stop` terminates all ten servers via forwarded `SIGTERM`.

## Port overview

| Port | Example | Strategy |
| ---- | ------------------------ | ------ |
| 4010 | `nextjs-cookie` | cookie |
| 4011 | `nextjs-route` | route |
| 4020 | `tanstack-cookie` | cookie |
| 4021 | `tanstack-route` | route |
| 4030 | `waku-cookie` | cookie |
| 4031 | `waku-route` | route |
| 4040 | `react-router-cookie` | cookie |
| 4041 | `react-router-route` | route |
| 4050 | `solidstart-cookie` | cookie |
| 4051 | `solidstart-route` | route |

`scripts/example-matrix.mjs` is the single source of truth for the ports. The
supervisor binds according to it automatically, and the `print-podman-ports.mjs`
call shown above generates the `-p` flags from it too – both follow along with no
manual step. Only the static `EXPOSE` line in the `Containerfile` is purely
informational and must be updated by hand when a port changes.

## Host binding

All servers listen on `0.0.0.0` inside the container so an external reverse proxy
can reach the published ports. Some frameworks otherwise bind only to
`127.0.0.1`; the supervisor overrides that in a container-specific way, without
touching the example `package.json` files:

- **SolidStart** (`vinxi`): `HOST=0.0.0.0` via environment variable
- **TanStack** (`vite preview`): the hardcoded `--host 127.0.0.1` in the script
  cannot be reliably overridden by an appended flag (Vite's CLI parser collects
  repeated flags into an array), so the supervisor runs `vite preview` directly
  with a single `--host 0.0.0.0`

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
