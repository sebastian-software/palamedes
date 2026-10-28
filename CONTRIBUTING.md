# Contributing

Thanks for taking the time to improve Palamedes. This project spans TypeScript
packages, a Rust core, framework examples, and release automation, so small,
well-scoped changes are easiest to review.

## Prerequisites

- Node.js `>=22.22`; use `>=24.3.0` when working on Remix examples
- pnpm via Corepack
- Rust — `rust-toolchain.toml` pins the workspace MSRV, so `rustup` installs it
  on the first `cargo` invocation; make sure `rustup` itself is up to date
- GitHub CLI if you work on issue or PR automation locally

```bash
corepack enable
pnpm install --frozen-lockfile
```

## Repository Shape

- `packages/` contains the JavaScript and TypeScript workspaces, including the
  public packages and shared internal UI packages.
- `crates/` contains the Rust core, CLI, plugin boundary, and Node native
  binding.
- `examples/` contains the framework apps used by smoke and browser
  verification.
- `site/` contains the private React Router workspace for
  [palamedes.dev](https://palamedes.dev).
- `docs/` contains the canonical guides and references; `adr/` contains the
  canonical architecture decisions.
- `benchmarks/` contains reproducible benchmark harnesses and checked results;
  `proof/` contains checked semantic proof fixtures.
- `tests/` contains repository-level browser contracts across the example
  apps.
- `scripts/` contains shared build, verification, release, and content
  generation automation.
- `.github/workflows/` contains CI, release, screenshot, and deployment
  automation.

## Local Checks

Run the smallest relevant check while iterating, then broaden before opening a
PR.

```bash
pnpm build
pnpm test
pnpm check-types
cargo test --workspace
```

Other useful checks:

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
pnpm verify:examples:smoke
pnpm check:release-set
pnpm check:binary-size
pnpm check:llms
pnpm readme:family:check
pnpm test:coverage
```

Formatter, linter, and dependency-policy configurations are maintained in this
repository. CI runs the checks above directly; there is no separate organization
configuration generator or drift check. Keep the existing rules and narrow
exceptions when updating these files. `pnpm lint` and `pnpm lint:fix` use Oxlint.
ESLint-specific style rules without an Oxlint equivalent are no longer part of
the repository gate.

Coverage is gated by this repository's own CI, not by an external service.
`pnpm test:coverage` runs the JavaScript suites with coverage and fails below
the line floor. The Rust half needs cargo-llvm-cov (`cargo install
cargo-llvm-cov`) and gates the same crates CI does:

```bash
cargo llvm-cov --workspace --locked \
  --fail-under-lines "$(node ./scripts/coverage-gate.mjs rust --threshold)"
```

Both floors live in `scripts/coverage-gate.mjs` and nowhere else:
`vitest.coverage.config.mts` reads the JavaScript one into
`coverage.thresholds.lines`, and the coverage job passes the Rust one to
cargo-llvm-cov. That same script prints `Line coverage (…): X% (gate: ≥ N%)`
into the GitHub run summary, so a run says what its number was even when the
gate rejected it. Raising a floor after coverage genuinely improves is a
one-line edit there; lowering one to turn a red run green is not.

`pnpm check:binary-size` builds the release CLI and core-node addon and holds
each artifact under its own fixed ceiling. Palamedes
ships prebuilt binaries for six platforms in both native families, so
anything baked into either artifact multiplies; the check exists because
linking a full Unicode collator once added 1.3 MB and only surfaced when someone
measured by hand. The script records the published Linux x64 GNU baseline and
the deliberate headroom behind each ceiling. CI runs the contract on the pinned
toolchain. Raising a ceiling is a deliberate edit to
`scripts/check-binary-size.mjs`, not something to do in passing.

Use `pnpm verify:examples` when a change touches framework integration,
runtime wiring, or `.po` loading. It is intentionally broader and slower than
the package unit tests.

## TypeScript Versions

The workspace deliberately runs two TypeScript majors. Every published package
and every example pins `typescript@^7`, which is what `pnpm check-types`
compiles them with. The repository root and `site/` pin `typescript@^6`, and the
root additionally declares `@typescript/typescript6` because the declaration
bundler used by `pnpm build` (`rollup-plugin-dts`, via `unbuild`) resolves that
package for its TypeScript 6 API. Do not "align" the two by bumping one side in
isolation: change the package floor and the root/site toolchain together, and
run `pnpm build`, `pnpm check-types`, and `pnpm --filter @palamedes/site
typecheck` before assuming a single version works everywhere.

## Website Development

Complete the repository prerequisites above, then start the website from the
repository root:

```bash
pnpm dev:site
```

The site is available at <http://localhost:4100>. The command runs
`site/scripts/prebuild-content.mjs` before it starts the React Router
development server. That prebuild reads the canonical `docs/`, `adr/`, and
`site/content/blog/` sources and the public package sources used by TypeDoc.
It generates Git-ignored routes and data under
`site/app/routes.ts`, `site/app/routes/docs/`, `site/app/routes/decisions/`,
`site/app/routes/blog/`, `site/app/routes/api-reference/`, and
`site/app/data/generated/`. Edit the canonical sources, not those generated
paths. The copied files under `site/public/docs/` are generated for the same
reason.

Before opening a pull request that changes the website, documentation, ADRs,
package API sources, or benchmark evidence, build and verify the site in this
order:

```bash
pnpm build:site
pnpm verify:site-routes
pnpm verify:site-a11y
pnpm verify:site-docs-dev
```

The browser checks use Playwright. If no compatible local Chrome or Chromium is
available, install the managed browser once:

```bash
pnpm exec playwright install chromium
```

The prebuild builds the compatible native compiler and compiles
`site/fragment-demo/` with the workspace Vite
adapter into the Git-ignored `site/public/fragment-demo/` directory. Edit its
source and catalogs, then rebuild; site development serves this production
demo too. `pnpm verify:site-a11y` checks its entry and lazy fragment requests,
locale isolation, byte receipts, module reuse, and failed-delivery recovery.

`pnpm build:site` checks benchmark data, the example matrix, editorial-rail
placement, Streamline assets, and generated Open Graph images before it
regenerates content and builds the static site. The route check then exercises
the built sitemap with default, reduced-motion, and JavaScript-disabled passes;
the accessibility check covers Axe and responsive overflow; and the docs
development check verifies cold-cache navigation, reload, and browser history.
Pull-request CI does not run the route check, which takes about ten minutes;
the Deploy Site workflow runs it before publishing. CI does run
`pnpm verify:site-outlines`, the route check's static comparison of the
generated docs with the prebuild's progressive outline manifest.

## Development Notes

- Keep changes scoped to one issue or one behavior.
- Prefer existing package boundaries over new shared packages unless the
  duplication is already causing real drift.
- For catalog behavior, preserve the source-string-first identity model:
  `message + context`.
- For server runtimes, keep request-local i18n concerns in
  `@palamedes/runtime/server`.
- Add or update tests when behavior changes, especially across package
  boundaries.

## Documentation

User-facing behavior should be discoverable from the README, package READMEs,
or `docs/`. Durable product, architecture, communication, and operational
decisions that constrain future work belong in `adr/`.
The [product context](./PRODUCT.md) records the audience and evidence-first
documentation goals that guide this public surface.

When adding a feature, include:

- the public API or CLI shape
- the failure mode or diagnostics users will see
- the migration note if behavior changes
- a short validation command

`llms.txt` and `llms-full.txt` are curated context files for coding assistants,
not generated API dumps. When a public CLI command, flag, package, or Node API
changes, refresh the relevant level of detail in both files and run `pnpm
check:llms`. The check ties the maintained context contract to the CLI docs,
published package manifests, and exported Node API names; the site build copies
the checked files to `palamedes.dev`. It also runs `scripts/check-docs-drift.mjs`
over every README, both llms files, `docs/`, and `skills/`: a guide may not set
an option from `REMOVED_PALAMEDES_OPTION_MESSAGES` outside migration,
troubleshooting, and changelog contexts, and every Solid install command must
carry the pins from `examples/solid-cookie/package.json`.

## README Generation

The root README is generated by native mdtheme from `README.md.src`. Sebastian
Software supplies the company badge and footer; the root omits Ferramenta
cross-promotion. Edit project prose in the source, then run
`mise run readme:write`; `mise run readme:check` checks the entire result. See [README themes](docs/readme-theme.md) for installation,
CI, and the pre-push command. mdtheme owns the root README and its company footer.

Published subpackage READMEs retain compact, plain-Markdown family blocks.
They use the pinned Ferramenta registry generator and require Node, pnpm, and
network access:

```sh
pnpm readme:family
pnpm readme:family:check
```

Update `GENERATOR_COMMIT` in the generator script to adopt a new family revision.
For the root README, update `mdtheme.yaml` and regenerate separately. Commit
pins and outputs together. Never edit generated family text by hand.

The React documentation site uses `ferramenta-family` from `site/package.json`.
To update that dependency, align its Git revision with `GENERATOR_COMMIT` in
`scripts/readme-family.mjs`, update the lockfile, and run the site's build.
The shared header and footer exclude this project from sibling links and
include sibling descriptions.

## Pull Requests

PRs should include:

- what changed
- why it changed
- which issue it closes or references
- which checks were run
- any follow-up work that is intentionally left out

Draft PRs are fine for early review, but keep them reviewable. Avoid mixing
format-only churn with behavior changes unless the PR is explicitly about
formatting.

## Releases

Releases are driven by Release Please. Use conventional commit-style messages
when possible, for example:

- `fix(core): handle missing descriptor fallback`
- `feat(cli): add catalog report command`
- `docs: add troubleshooting guide`
- `ci: expand native build matrix`

`.release-policy.json` gates release creation and package publication,
including forced package publication. With `publicationEnabled: false`, Release
Please does not run and the Publish workflow uploads nothing; with `true`, it
still rejects versions below `minimumMajor` and prerelease versions. Demo
container publication follows `main` independently; it does not authorize a
package release. Publication is enabled for the coordinated `2.0.0` release, and
the next Release Please version is explicitly `2.0.0`; the current version files
continue to describe the last release until its generated release PR lands. A
Publish workflow dispatch with `dry_run` still builds and verifies artifacts
without publishing.

The v2 migration, representative TanStack React and Solid 2 Start Mode/Nitro
verification, focused French examples, Node deployment proofs, and the
release-layout migration are complete. Rust SDK archives, independent consumers,
and the dependency-ordered release lane are implemented; #1309 tracks the
remaining registry ownership and credential verification. #1204 owns final
coordinated acceptance. The [support tiers](docs/stability.md),
[framework evidence](docs/framework-example-notes.md), and
[migration guide](docs/migration-v2.md) define the supported scope. TanStack
Solid Start and additional translation-assistance features are outside the v2
release requirements.

The release-enablement change followed these steps. Repeat them if publication
is ever held again and later re-enabled:

1. Run `pnpm check:release-set`, `pnpm check:workflow-contracts`, and the Publish
   workflow with `dry_run` against the held source revision. This verifies the
   implementation with the current manifest versions; it is not evidence for
   the future versioned 2.0 artifacts. The dry run checks package builds,
   declarations, tests, native artifacts for all six platforms, the packed
   JavaScript manifests in publish order, crates.io names and ownership, and
   the staged Rust SDK consumer without uploading packages.
2. Resolve registry readiness separately: `node scripts/check-first-publish.mjs`
   checks that npm package names already exist; it does not verify trusted
   publisher configuration. Follow #1309 and the
   [Rust distribution guide](docs/rust-applications.md#preview-and-publication)
   for crates.io ownership and release credentials. A passing dry run does not
   establish publication permissions.
3. Obtain explicit release authorization before enabling `publicationEnabled`
   in a reviewed PR. Cargo publication additionally requires explicit
   `publish = ["crates-io"]` allowlists on the three SDK crates (`palamedes-i18n`,
   `palamedes`, and `palamedes-build`); `palamedes-cli`, `palamedes-node`, and
   `palamedes-plugin` keep `publish = false`. Keep the current versions until the
   generated Release Please PR applies the coordinated `2.0.0` version.

After authorized enablement generates the Release Please PR, run the Publish
workflow with `dry_run` on that PR's exact 2.0 revision before merging it. The
release PR merge triggers actual publication; a source dry run at `1.25.1` does
not replace this versioned artifact check. Only a commit titled
`chore: release main` (optionally with its pull request number) starts a
publication. Before any upload, the actual publication also runs the Cargo
preflight: it exchanges the workflow's OIDC identity for a crates.io token and
checks the policy, allowlists, and ownership, so npm cannot ship a release that
crates.io then rejects. Real releases and dry runs also call the Example
Verification workflow on the exact release revision, so the example smoke
checks, the browser matrix, and the framework delivery proofs must pass before
any upload, whatever the PR path filters selected.

`pnpm release:rust:dry-run` can run the SDK staging check locally without
uploading. Once enabled, publication still rejects versions below
`minimumMajor` and prerelease versions. After publishing, verify that every
coordinated npm and Cargo package is available before closing #1204.

`.release-please-config.json` carries two one-time overrides for 2.0.0:
`release-as` and the top-level `last-release-sha`, which starts the 2.0.0
changelog at the unpublished 1.25.1 release commit (tag `palamedes-v1.25.1`)
instead of re-listing 1.x entries. Leave both in place through the generated
release PR: Release Please rebuilds that PR from the config on `main` and
force-pushes its branch, so edits there do not last. Once 2.0.0 is released,
remove both in a normal follow-up PR on `main`. `pnpm check:release-set` asks
`origin` for the `palamedes-v<manifest version>` tag. While that tag points at
a commit other than the one being checked, it fails if `release-as` is still
at the manifest version, so the next feat or fix cannot open another
"release 2.0.0" PR, and if `last-release-sha` remains. A corrective follow-up
commit must remove them too, but that cleanup does not make an already-published
version reusable; follow [partial-release recovery](#recovering-a-partial-release).
If the tag cannot be read, the check only warns in CI but fails in the Publish
workflow's release validation.

`palamedes-build` inherits an exact `=` requirement on `palamedes-i18n` from
the root `[workspace.dependencies]`, because the code it generates constructs
hidden `palamedes-i18n` items. Release Please's Cargo updater would rewrite a
member's `=` requirement as a caret one, so the generic `Cargo.toml`
extra-file bumps the marked workspace line instead, and
`pnpm check:release-set` asserts the pin matches the workspace version.

Run `pnpm check:release-set` and
`pnpm check:workflow-contracts` when changing policy or workflow wiring.
`pnpm check:release-wording` (run by CI and the Publish workflow) fails once the
release version reaches 2.0.0 while held, draft, or unreleased v2 wording remains
in the listed public files, so the release PR must clear that wording.

Do not edit generated changelog entries by hand unless the release automation
requires a specific correction.

### Recovering a Partial Release

Check the failed Publish run's commit and job results, then inspect which npm
and Cargo versions reached their registries. Uploads cannot be rolled back as a
coordinated set.

For a transient failure or a registry configuration fix that needs no repository
change, re-run the original Publish run with **Re-run all jobs**, or
`gh run rerun RUN_ID` with that run's ID. [GitHub re-runs preserve the original
commit and ref](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs).
The workflow rebuilds and verifies that revision. npm skips versions that already
exist; Cargo skips a version only when its rebuilt archive has the exact published
checksum and is not yanked. If the archive still differs, stop and investigate
the build inputs instead of bypassing the checksum check.

Do not use `force_publish` on a newer commit to replace published packages.
Cargo embeds the source commit in `.cargo_vcs_info.json`, so even a commit that
only changes files outside a crate changes its archive. The Cargo lane rejects
that mismatch, while npm skips the existing version without comparing its
contents. Neither path updates an already-published package. `force_publish`
only bypasses release-commit detection; policy, version, ownership, and archive
checks still apply.

If recovery requires a source or workflow commit after any package was uploaded,
merge the correction and remove stale release overrides, then use Release Please
to prepare a new coordinated version. Run the Publish dry run on that release
PR's exact revision before merging it. Verify that the new version is available
for the complete npm and Cargo release set before closing the failure issue.

#
