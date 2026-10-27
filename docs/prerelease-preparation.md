# Prepare the v2 bootstrap candidate

Use one functional `2.0.0-alpha.1` candidate to inspect the first Cargo archives
and exercise CLI installation before stable v2. This is a one-time bootstrap
preparation, not an independent Rust SDK release channel. Nothing in this path
publishes a package, changes `latest`, creates a credential, or enables the normal
stable release workflow.

From a clean, committed checkout, fetch the two committed dependency graphs so
the version-only lockfile updates can run offline, then stage a new directory
outside the repository:

```sh
cargo fetch --locked
cargo fetch --manifest-path fuzz/Cargo.toml --locked
node scripts/prepare-prerelease.mjs 2.0.0-alpha.1 /tmp/palamedes-v2-alpha1
```

The command exports the exact committed source revision and records its commit
and tree in `candidate.json`. It coordinates all six Rust workspace packages and
all 29 npm manifests, pins internal Cargo requirements to the exact prerelease,
updates both Cargo lockfiles offline, and checks the release set. The private Rust
example keeps its own version. The source checkout is unchanged, existing output
directories are refused, and the copied publication policy remains disabled.
Only the three candidate SDK manifests receive explicit crates.io allowlists.
The normal stable publisher still rejects this candidate and remains held.

## Verify Cargo archives

In the staged directory, run:

```sh
node scripts/verify-rust-sdk.mjs
```

The existing proof packages `palamedes-i18n`, `palamedes`, and `palamedes-build`
in that order, verifies their file inventories, metadata, licenses, builds and
rustdoc, and installs the exact versions into an independent consumer through a
loopback sparse registry. It exercises external catalogs, plurals, expected
failures, and a PO update without rebuilding the copied executable. Archive
checksums and consumer locations are in `target/rust-sdk-proof/receipt.json`.
This proves the archives locally; it does not prove crates.io ownership or OIDC.

## Prepare the CLI test package

Install the staged workspace dependencies with the frozen pnpm lockfile. Build
the CLI wrapper and each native CLI package on its supported build host, using
the same validated update endpoint as a release build. Pack the wrapper and all
six matching platform packages with pnpm so `workspace:*` becomes the exact
candidate version. Inspect every archive, native binary and external catalog.
Keep a checksum receipt for the tarballs.

A local wrapper/host-sidecar installation is useful evidence for that host only.
It is not an upload-ready cross-platform release: all six native packages must
exist before publishing the wrapper. Reuse the native matrix and its GNU, musl,
Windows and macOS smoke checks before authorizing that operation. Core Node and
the other JavaScript packages remain in the coordinated inventory; a focused CLI
test does not claim that all 29 packages were built or published.

Before upload, resolve Ferromark's nested-link parser finding in
[Ferromark #570](https://github.com/sebastian-software/ferromark/issues/570), adopt
a published version containing the fix, and rerun the parser regression against
the exact candidate graph. An archive built against the old parser must not be
approved by reusing a proof that substituted a local parser patch.

## Review before the first upload

`candidate.json` deliberately says `readyForUpload: false`. Review the exact
source, versions, dependency ranges, archive checksums, successful package/install
proofs, intended direct Cargo owner, and a narrowly scoped first-publication
operation before requesting upload authorization. Do not reuse the stable
publisher with its hold removed or publish empty reservation crates.

After the functional Cargo first publications, configure each crate's intended
trusted publisher and implement the matching OIDC exchange. Verify a real
registry-only SDK consumer and a published CLI test build against the shared
tracking service, using only an owned synthetic identity and removing its test
reports afterward. Keep explicit telemetry consent, no-consent updates, CI
isolation, output/exit semantics, offline/retry, withdrawal and deletion checks.
Local staging cannot replace these registry and service acceptance checks.

Track the remaining registry work in [#1309](https://github.com/sebastian-software/palamedes/issues/1309),
the npm release proof in [#1357](https://github.com/sebastian-software/palamedes/issues/1357),
and coordinated stable acceptance in [#1204](https://github.com/sebastian-software/palamedes/issues/1204).
