# Contributing

Thanks for taking the time to improve Palamedes. This project spans TypeScript
packages, a Rust core, framework examples, and release automation, so small,
well-scoped changes are easiest to review.

## Prerequisites

- Node.js `>=22.22`
- pnpm via Corepack
- Rust stable toolchain
- GitHub CLI if you work on issue or PR automation locally

```bash
corepack enable
pnpm install --frozen-lockfile
```

## Repository Shape

- `packages/*` contains the published JavaScript and TypeScript packages.
- `crates/*` contains the Rust core and Node native binding.
- `examples/*` contains framework verification apps.
- `docs/` and `adr/` explain product, architecture, and adoption decisions.
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
```

Use `pnpm verify:examples` when a change touches framework integration,
runtime wiring, or `.po` loading. It is intentionally broader and slower than
the package unit tests.

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
or `docs/`. Architecture decisions that constrain future work belong in
`adr/`.

When adding a feature, include:

- the public API or CLI shape
- the failure mode or diagnostics users will see
- the migration note if behavior changes
- a short validation command

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
