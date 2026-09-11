# Contributing

Thanks for taking the time to improve Palamedes. This project spans TypeScript
packages, a Rust core, framework examples, and release automation, so small,
well-scoped changes are easiest to review.

## Prerequisites

- Node.js `>=22.22`
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

`pnpm build:site` checks benchmark data, the example matrix, editorial-rail
placement, Streamline assets, and generated Open Graph images before it
regenerates content and builds the static site. The route check then exercises
the built sitemap with default, reduced-motion, and JavaScript-disabled passes;
the accessibility check covers Axe and responsive overflow; and the docs
development check verifies cold-cache navigation, reload, and browser history.

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
the checked files to `palamedes.dev`.

## The Ferramenta family block

The root README is generated by native mdtheme from `README.md.src`. Sebastian
Software is the outer frame and Ferramenta the inner frame. Edit project prose
in the source, then run `mise run readme:write`; `mise run readme:check` checks
the entire result. See [README themes](docs/readme-theme.md) for installation,
CI, and the pre-push command. Standards explicitly delegates README
ownership to mdtheme and does not append a company footer.

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
Keep its Git revision aligned with the Ferramenta theme in `mdtheme.yaml`,
update the lockfile, and run the site's build. The shared header and footer
exclude this project from sibling links and include sibling descriptions.

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

During the coordinated v2 implementation, `.release-policy.json` holds release
creation and package/container publication, including forced publication. The
next Release Please version is explicitly `2.0.0`; the current version files
continue to describe the last release until its generated release PR lands.
Implementation PRs can merge into `main` behind this hold. A Publish workflow
dispatch with `dry_run` still builds and verifies artifacts without publishing.

Complete #1215's migration and host verification, coordinate the corrected
#1154 standards `rust-node-product` release layout, and obtain explicit release
authorization before enabling `publicationEnabled` in a reviewed PR. The hold
is independent of that layout migration; it does not replace it. Once enabled,
publication still rejects versions below `minimumMajor` and prerelease versions.
Remove the one-time `release-as` override after 2.0.0 is released so subsequent
versions follow conventional commits again. Run `pnpm check:release-set` and
`pnpm check:workflow-contracts` when changing this policy or its workflow wiring.

Do not edit generated changelog entries by hand unless the release automation
requires a specific correction.

#
