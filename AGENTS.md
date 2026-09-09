**Effective Flow project setup:** adr/028-effective-flow-project-setup.md

# Palamedes project guidance

## Repository shape and decisions

- `crates/` contains the Rust core, CLI, Node binding, and plugin SDK. `packages/` contains the JavaScript packages and native sidecars; `examples/` contains the integration matrix.
- `docs/` contains product and API documentation. The documentation site lives in `site/` and is built from the repository content.
- ADRs live under `adr/` and are indexed by `DECISIONS.md`. Read the relevant ADR before changing a boundary or workflow; ADR-028 defines the Effective Flow setup for this repository.

## Change preflight

- Work in a fresh isolated worktree, preferably under `/private/tmp`, and leave the primary checkout and other agents' worktrees unchanged. Record the worktree, base revision, and final revision in the handoff.
- Before editing, confirm the worktree root with `git rev-parse --show-toplevel`, inspect `git status --short --branch`, and verify the intended base with `git rev-parse HEAD` and `git rev-parse origin/main`.
- Read `CONTRIBUTING.md`, the relevant package or crate guidance, and the ADRs that govern the change. Keep generated or standards-managed files under their existing generators and markers.
- Run focused checks first. Before committing, run `git diff --check`, inspect the staged diff, stage only intended paths, and record the resulting commit with `git rev-parse HEAD`.

## Validation commands

- JavaScript and documentation changes: `pnpm format:check`, `pnpm lint`, and the affected package's `pnpm --filter <package> test` command. Use `pnpm check:decisions` for ADR changes, `pnpm check:llms` for public documentation surfaces, and `pnpm check:readme` for README changes.
- Rust changes: `cargo fmt --all --check`, `cargo clippy --workspace --all-targets --all-features -- -D warnings`, and the narrowest relevant `cargo test` command. The workspace gate is `cargo test --workspace --locked`.
- Release or workflow changes: run `pnpm check:release-set` and `pnpm check:workflow-contracts`; the repository-wide combined gate is `pnpm agent:check` when its build, package, and environment requirements are available.

---

<!-- sebastian-software-consumer-agents:start -->

# Standards-managed repo guardrails

- Do not hand-edit managed files or standards-owned marker sections.
- If `standards check` reports drift, run `standards apply` or update standards.
- The repository's own gate may omit `standards check`; CI can still fail on it.

Node repositories:

- Fix or format every file reported by `oxfmt` whenever practical.
- For generated files, prefer formatting in the generator step.
- If formatting is not viable, use repo-local `.prettierignore`.
- Never add repo-specific ignores to managed `.oxfmtrc.json`.

Rust repositories:

- Keep `cargo fmt --all --check` and
  `cargo clippy --workspace --all-targets --all-features -- -D warnings` green.
- Lint levels belong in `[workspace.lints]`, never in managed `rustfmt.toml`.
- `rust-version` in `Cargo.toml` is the only MSRV; every other mention is a
  derived copy.
- Record a cargo-deny finding as a narrow, commented exception in `deny.toml` —
  never by widening the org allow-list.

<!-- sebastian-software-consumer-agents:end -->
