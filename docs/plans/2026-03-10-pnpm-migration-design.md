# pnpm Migration Design

**Date:** 2026-03-10
**Status:** Approved
**Branch:** `t3code/plan-pofile-thin-ts-wrapper`

## Summary

Palamedes should migrate from Yarn 4 with Plug'n'Play to `pnpm` with a standard `node_modules` workspace layout.

The goal is not only to swap lockfiles. The repo should present a consistent `pnpm`-first developer workflow across root scripts, workspace commands, examples, and package documentation.

## Scope

- replace Yarn 4 + PnP repo configuration with `pnpm`
- use a `pnpm-workspace.yaml` workspace definition
- update root scripts and package-level development commands to `pnpm`
- update README instructions across the repo to `pnpm`
- remove Yarn- and PnP-specific repo artifacts
- generate and commit `pnpm-lock.yaml`

## Non-Goals

- changing the published package runtime behavior
- redesigning CI pipelines outside the repo
- changing Rust build tooling

## Decisions

- `packageManager` should target the current latest `pnpm` release during migration
- the repo should use `pnpm` workspaces plus normal `node_modules`, not PnP
- workspace-local commands should prefer `pnpm --filter <package> ...`
- root multi-package commands should prefer `pnpm -r ...`

## Planned Changes

1. Add `pnpm-workspace.yaml` for `packages/*` and `examples/*`.
2. Update root `package.json` scripts from Yarn to `pnpm`.
   Root `build` should target packages, with examples exposed separately.
3. Add package `test` scripts where needed so root testing can use recursive `pnpm` commands.
4. Rewrite development and install docs to use `pnpm`.
5. Remove `.pnp.cjs`, `.pnp.loader.mjs`, `.yarn/`, and `yarn.lock`.
6. Run `pnpm install` and commit `pnpm-lock.yaml`.

## Verification

- `pnpm install`
- `pnpm -r build`
- `pnpm test`
- `cargo test --workspace`

## Risks

- some package scripts may rely on implicit Yarn behavior
- some docs may still reference outdated commands after the switch
- recursive `pnpm` execution may expose missing per-package scripts
