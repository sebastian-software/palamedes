# Run all 41 Palamedes example apps side by side in a single container, each
# on its fixed port from the shared container inventory. Built and run with Podman:
#
#   podman build --format docker -f Containerfile -t palamedes-examples .
#   podman run --rm --init \
#     -p 4010:4010 -p 4011:4011 -p 4012:4012 -p 4013:4013 \
#     -p 4020:4020 -p 4021:4021 -p 4022:4022 -p 4023:4023 \
#     -p 4030:4030 -p 4031:4031 -p 4032:4032 -p 4033:4033 \
#     -p 4040:4040 -p 4041:4041 -p 4042:4042 -p 4043:4043 \
#     -p 4050:4050 -p 4051:4051 -p 4052:4052 -p 4053:4053 \
#     -p 4060:4060 -p 4061:4061 -p 4062:4062 -p 4063:4063 \
#     -p 4070:4070 \
#     -p 4090:4090 -p 4091:4091 -p 4092:4092 -p 4093:4093 \
#     -p 4100:4100 -p 4101:4101 -p 4102:4102 -p 4103:4103 \
#     -p 4110:4110 -p 4111:4111 -p 4112:4112 -p 4113:4113 \
#     -p 4120:4120 -p 4121:4121 -p 4122:4122 -p 4123:4123 \
#     palamedes-examples
#
# (or let the matrix generate the flags: `podman run --init \
#   $(node ./scripts/container/print-podman-ports.mjs) palamedes-examples`)
#
# A reverse proxy mapping each port to its own domain is intentionally out of
# scope; the fixed ports exist so that mapping can be added later.

# --- Rust toolchain stage ----------------------------------------------------
# Digest-pinned official Rust toolchain image avoids remote shell installers.
# Move its sysroot to a fixed path so the build stage invokes the exact
# digest-pinned compiler binaries directly rather than letting rustup download
# a separate toolchain from rust-toolchain.toml.
FROM rust:1.96-bookworm@sha256:a339861ae23e9abb272cea45dfafde21760d2ce6577a70f8a926153677902663 AS rust-toolchain
RUN mv "$(rustc --print sysroot)" /usr/local/rust

# --- Build stage -------------------------------------------------------------
# glibc (Debian) base so the native @palamedes/core-node addon builds for
# linux-*-gnu without cross-compilation.
FROM node:24-bookworm@sha256:49f7adaf9f1574bc45c20ea317139b39a59d7e758d0e93745e112fd85cb42623 AS build

# Build essentials for compiling the native N-API addon plus the Rust toolchain
# copied directly from the digest-pinned official image above.
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=rust-toolchain /usr/local/rust /usr/local/rust
ENV PATH="/usr/local/rust/bin:${PATH}"

# Build the native addon in release mode (build-native.mjs reads this).
ENV PALAMEDES_RUST_PROFILE=release \
    COREPACK_HOME="/usr/local/share/corepack"

WORKDIR /app
# corepack provisions pnpm at the exact packageManager specification in
# package.json (preserving any integrity hash) into COREPACK_HOME, which is
# copied read-only into the runtime stage.
COPY package.json ./
RUN corepack enable \
  && corepack prepare --activate \
  && chmod -R a+rX /usr/local/share/corepack

# Verify the copied Rust compiler satisfies the workspace MSRV in Cargo.toml
# before pnpm launches the CLI and Node native builds concurrently.
COPY Cargo.toml ./
COPY rust-toolchain.toml ./
RUN cargo --version \
  && node -e 'const fs=require("node:fs"),{execFileSync}=require("node:child_process");const msrv=fs.readFileSync("Cargo.toml","utf8").match(/^rust-version\s*=\s*"([^"]+)"/mu)?.[1];const actual=execFileSync("rustc",["--version"],{encoding:"utf8"}).match(/rustc (\d+\.\d+\.\d+)/u)?.[1];if(!msrv||!actual)process.exit(1);const toNums=(v)=>v.split(".").map(Number);const [aMaj,aMin,aPat]=toNums(actual);const [mMaj,mMin,mPat=0]=toNums(msrv);const ok=aMaj>mMaj||(aMaj===mMaj&&(aMin>mMin||(aMin===mMin&&aPat>=mPat)));if(!ok){console.error(`Pinned rustc ${actual} is older than Cargo.toml rust-version ${msrv}`);process.exit(1);}'

COPY . .

RUN pnpm install --frozen-lockfile
# `pnpm build` builds the workspace packages and compiles the native addon via
# cargo; `pnpm build:examples` builds every app in `examples/`.
RUN pnpm build
RUN pnpm build:examples
RUN node scripts/build-component-demos.mjs
# Drop build-only artifacts and non-runtime directories before they reach the
# runtime image: the compiled .node was already copied into the platform
# package (target/ is dead weight), Next.js build caches are not needed by
# `next start`, and source/docs/test trees are unused at runtime. Normalize
# permissions (`a+rX,go-w`) so root-owned files copied into the runtime stage
# stay readable/traversable yet read-only for `node` regardless of host umask.
RUN rm -rf target \
  examples/*/.next/cache \
  crates \
  docs \
  adr \
  tests \
  test-fixtures \
  benchmarks \
  fuzz \
  site \
  video \
  && find /app /usr/local/share/corepack ! -type l -exec chmod a+rX,go-w {} +

# --- Runtime stage -----------------------------------------------------------
# Dev dependencies stay installed on purpose: TanStack's `vite preview` needs
# them. Solid v2 starts Nitro's generated `.output` directly.
FROM node:24-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530 AS runtime

ENV NODE_ENV=production \
    COREPACK_HOME="/usr/local/share/corepack" \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    COREPACK_ENABLE_NETWORK=0 \
    pnpm_config_verify_deps_before_run=false

# tini as PID 1 reaps reparented grandchildren reliably, even when the container
# is started without `podman run --init` (e.g. later via Compose/Quadlet).
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

WORKDIR /app
# Own /app and the pre-populated Corepack cache as root:root so the
# unprivileged `node` runtime user has read-only access to application code
# and supervisor scripts.
COPY --from=build --chown=root:root /usr/local/share/corepack /usr/local/share/corepack
COPY --from=build --chown=root:root /app /app
# Run all 41 example servers as a non-root user (least privilege).
USER node

# Fixed ports — informational only; the authoritative list is
# scripts/example-matrix.mjs and scripts/component-demos.mjs. Publish them without drift via:
#   podman run $(node ./scripts/container/print-podman-ports.mjs) palamedes-examples
EXPOSE 4080 4010 4011 4012 4013 4020 4021 4022 4023 4030 4031 4032 4033 4040 4041 4042 4043 4050 4051 4052 4053 4060 4061 4062 4063 4070 4090 4091 4092 4093 4100 4101 4102 4103 4110 4111 4112 4113 4120 4121 4122 4123

# Probe the supervisor readiness endpoint using the bundled Node runtime
# (the slim base intentionally omits curl).
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4080/ready',{signal:AbortSignal.timeout(8000)}).then((r)=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

# tini is the init/reaper (no external `--init` needed). `-s` registers it as a
# subreaper so reaping still works if it ends up not as PID 1 (e.g. when the
# container is additionally started with `--init`).
ENTRYPOINT ["/usr/bin/tini", "-s", "--"]
CMD ["node", "scripts/container/start-all.mjs"]
