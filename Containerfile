# Run all 24 Palamedes example apps side by side in a single container, each
# on its fixed port from scripts/example-matrix.mjs. Built and run with Podman:
#
#   podman build -f Containerfile -t palamedes-examples .
#   podman run --rm --init \
#     -p 4010:4010 -p 4011:4011 -p 4012:4012 -p 4013:4013 \
#     -p 4020:4020 -p 4021:4021 -p 4022:4022 -p 4023:4023 \
#     -p 4030:4030 -p 4031:4031 -p 4032:4032 -p 4033:4033 \
#     -p 4040:4040 -p 4041:4041 -p 4042:4042 -p 4043:4043 \
#     -p 4050:4050 -p 4051:4051 -p 4052:4052 -p 4053:4053 \
#     -p 4060:4060 -p 4061:4061 -p 4062:4062 -p 4063:4063 \
#     palamedes-examples
#
# (or let the matrix generate the flags: `podman run --init \
#   $(node ./scripts/container/print-podman-ports.mjs) palamedes-examples`)
#
# A reverse proxy mapping each port to its own domain is intentionally out of
# scope; the fixed ports exist so that mapping can be added later.

# --- Build stage -------------------------------------------------------------
# glibc (Debian) base so the native @palamedes/core-node addon builds for
# linux-*-gnu without cross-compilation.
FROM node:24-bookworm AS build

# Rust toolchain (for the native N-API addon) plus build essentials.
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
ENV PATH="/root/.cargo/bin:${PATH}"

# Build the native addon in release mode (build-native.mjs reads this).
ENV PALAMEDES_RUST_PROFILE=release

WORKDIR /app
# corepack provisions pnpm at the exact version pinned in package.json
# (packageManager) on first use — no hardcoded version here.
RUN corepack enable

COPY . .

RUN pnpm install --frozen-lockfile
# `pnpm build` builds the workspace packages and compiles the native addon via
# cargo; `pnpm build:examples` builds all 24 example apps.
RUN pnpm build
RUN pnpm build:examples
# Drop build-only artifacts before they reach the runtime image: the compiled
# .node was already copied into the platform package (target/ is dead weight),
# and the Next.js build caches are not needed by `next start`.
RUN rm -rf target && rm -rf examples/*/.next/cache

# --- Runtime stage -----------------------------------------------------------
# Dev dependencies stay installed on purpose: TanStack's `vite preview` and
# SolidStart's `vinxi start` live in devDependencies, so we do not prune them.
FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production

# tini as PID 1 reaps reparented grandchildren reliably, even when the container
# is started without `podman run --init` (e.g. later via Compose/Quadlet).
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build --chown=node:node /app /app
# Global pnpm at the version pinned in package.json (packageManager) so the
# unprivileged `node` user can run the example start scripts.
RUN npm install -g "pnpm@$(node -p 'require("./package.json").packageManager.split("@")[1].split("+")[0]')"
# Run the 24 public servers as a non-root user (least privilege).
USER node

# Fixed ports — informational only; the authoritative list is
# scripts/example-matrix.mjs. Publish them without drift via:
#   podman run $(node ./scripts/container/print-podman-ports.mjs) palamedes-examples
EXPOSE 4010 4011 4012 4013 4020 4021 4022 4023 4030 4031 4032 4033 4040 4041 4042 4043 4050 4051 4052 4053 4060 4061 4062 4063

# tini is the init/reaper (no external `--init` needed). `-s` registers it as a
# subreaper so reaping still works if it ends up not as PID 1 (e.g. when the
# container is additionally started with `--init`).
ENTRYPOINT ["/usr/bin/tini", "-s", "--"]
CMD ["node", "scripts/container/start-all.mjs"]
