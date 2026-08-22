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
```

`pnpm check:binary-size` builds the release CLI and core-node addon and holds
each artifact under its own fixed ceiling. Palamedes
ships prebuilt binaries for eight platforms in both native families, so
anything baked into either artifact multiplies; the check exists because
linking a full Unicode collator once added 1.3 MB and only surfaced when someone
measured by hand. The script records the published Linux x64 GNU baseline and
the deliberate headroom behind each ceiling. CI runs the contract on the pinned
toolchain. Raising a ceiling is a deliberate edit to
`scripts/check-binary-size.mjs`, not something to do in passing.

Use `pnpm verify:examples` when a change touches framework integration,
runtime wiring, or `.po` loading. It is intentionally broader and slower than
the package unit tests.

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
`site/app/routes/docs/`, `site/app/routes/decisions/`,
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

Do not edit generated changelog entries by hand unless the release automation
requires a specific correction.
