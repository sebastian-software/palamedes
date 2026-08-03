# ADR-024: The npm Launcher Is A Packaging Bridge With A Node-Free Escape Hatch

**Status:** Accepted
**Date:** 2026-08-03

## Context

Since ADR-016/017 the CLI is one native executable; the npm `@palamedes/cli`
package only selects the installed platform package and spawns it. npm remains
the primary distribution channel because the CLI version must be pinned per
project in `package.json` and travel with every checkout — global channels
cannot satisfy that.

The launcher exists because of a structural npm gap: package managers link only
the installed package's own `bin` entries. A platform-neutral package cannot
expose a transitive optional dependency's executable as its public bin, and
pnpm links no transitive bins at all. Bun and Deno share the same model; Bun's
own npm distribution works around it with a lifecycle script.

Constraints on any refinement:

- installation stays lifecycle-free (`--ignore-scripts` must work; pnpm ≥ 10
  blocks scripts by default) — verified by the packed-package smoke test
- native Windows through generated cmd/PowerShell shims and Yarn PnP are
  supported execution paths
- CLI semantics exist exactly once, in Rust

The wrapper's real cost is one Node boot (~30–50 ms) and an idle Node parent
process per invocation. `pmds` is invoked at low frequency (extraction, audits,
one CI run), so this cost is small in absolute terms but visible in process
lists and long-running watch workflows.

## Decision

1. `@palamedes/cli` keeps the minimal Node launcher as its public `pmds` bin:
   platform selection, spawn, exit-code propagation, and `SIGINT`/`SIGTERM`
   forwarding to the native child. It never parses commands or loads
   configuration. On Unix it isolates the native process group before
   forwarding so terminal signals are delivered exactly once.
2. Every platform package additionally declares its own `bin` entry pointing at
   the native executable. Environments that know their platform ahead of time —
   CI images, deployment targets — may depend on the platform package directly
   and get a native `pmds` without any Node process.
3. Nothing is installed, downloaded, copied, or rewritten at install time or at
   run time.

## Alternatives Considered

- **Installing or downloading the binary at run time:** rejected. It
  reintroduces network and registry access after install, breaks air-gapped
  CI, and bypasses lockfile trust — while `optionalDependencies` already
  deliver the correct binary during installation.
- **Postinstall binary swap (esbuild pattern):** rejected. It requires the
  lifecycle scripts this distribution deliberately avoids, and in-place writes
  to pnpm's hard-linked store files can corrupt the machine-wide store.
- **First-run shim self-replacement:** deferred. Rewriting only the generated
  `node_modules/.bin` shims (atomically, with a spawn fallback, never touching
  package contents) is feasible and lifecycle-free, but buys ~40 ms per
  invocation on a low-frequency CLI at the price of self-modifying
  installations and a per-package-manager test matrix. Revisit if long-running
  watch workflows make the resident wrapper a measured cost.
- **`#!/bin/sh` exec launcher:** rejected. Windows shims are generated from the
  shebang, so cmd/PowerShell users would need `sh` on `PATH`, and Yarn PnP has
  no `node_modules` layout for shell path resolution. The breakage would be
  per-terminal and invisible to CI, whose Windows runners carry Git Bash tools
  on `PATH`. Revisit only if Windows support is officially narrowed to
  WSL/Git Bash and the win32 package is dropped.
- **The CLI as an N-API library (`runCli(argv)`):** rejected. It would require
  a cdylib artifact beside the still-required standalone executable (plugins
  receive `PALAMEDES_NATIVE` from the running executable; direct-binary
  channels need it too), move process-owner assumptions such as clap's
  help/error exits and signal ownership into a host process, and make Node the
  permanent CLI host instead of a launchpad. In-process bindings belong to the
  programmatic engine surface of `@palamedes/core-node` (ADR-007). Revisit
  only if a genuine in-process JS↔Rust workflow API is needed — then as
  core-node surface, never as the CLI shell.
- **Global system channels as primary distribution (Homebrew and similar):**
  rejected as primary because per-project version pinning is a requirement.
  They remain possible later as additional channels.

## Consequences

- The wrapper cost is bounded and avoidable: wherever the platform is known,
  the platform package's own bin runs the native binary with zero Node
  involvement.
- The bin name `pmds` exists in the neutral package and in each platform
  package. pnpm links only direct dependencies' bins, so the duplicate stays
  inert unless a platform package is added deliberately; under npm hoisting a
  linked platform bin matches the host platform by construction and starts the
  same pinned version.
- There are two small launcher artifacts (JavaScript platform selection and the
  platform `bin` declarations) but still exactly one implementation of CLI
  semantics.
- The launcher remains deletable the day package managers expose a transitive
  optional dependency's bin as a public bin (ADR-017's standing consequence).
