# npm Trusted Publisher Design

**Date:** 2026-03-11
**Status:** Approved
**Branch:** `main`

## Summary

Palamedes should move to automated npm releases via GitHub Actions using npm Trusted Publisher and Node 24.

The release flow should stay simple for users: all publishable packages share one version, releases are cut automatically from `main`, and npm credentials should not be stored long-term once Trusted Publisher is active.

Because npm Trusted Publisher can only be attached after packages already exist on npm, the initial publication should happen locally. After that bootstrap step, publishing should switch fully to GitHub Actions with OIDC.

## Scope

- add a monorepo release process for all publishable npm packages
- use one shared version across publishable packages
- standardize CI and release execution on Node 24
- publish from GitHub Actions via npm Trusted Publisher after bootstrap
- add placeholder packages for `palamedes` and `create-palamedes`

## Non-Goals

- building a real project scaffolding flow in `create-palamedes`
- designing prereleases, canaries, or release branches
- introducing independent package versioning
- keeping token-based npm publishing as the steady-state release path

## Decisions

- use `changesets` for versioning, changelog generation, and release PR management
- keep all publishable packages on an identical version
- trigger release automation from `main`
- run CI and release jobs on Node `24.x`
- bootstrap the first npm publication locally instead of through CI
- reserve both `palamedes` and `create-palamedes` now with minimal placeholder packages

## Package Set

The release stream should cover the existing publishable workspace packages plus two new reserved packages:

- `@palamedes/cli`
- `@palamedes/core-node`
- `@palamedes/extractor`
- `@palamedes/next-plugin`
- `@palamedes/runtime`
- `@palamedes/transform`
- `@palamedes/vite-plugin`
- `palamedes`
- `create-palamedes`

## Release Architecture

### Versioning

- `changesets` manages release notes and version bumps
- all publishable packages move together on one shared version
- internal workspace dependencies should be rewritten to the same published version during release

### CI

A validation workflow should run on `pull_request` and `push` for `main` and execute at least:

- install with `pnpm`
- `pnpm build`
- `pnpm test`
- `pnpm check-types`

This workflow should use Node `24.x` consistently.

### Automated Publishing

A dedicated release workflow should run on `push` to `main` and use `changesets/action`.

The workflow behavior should be:

1. if unpublished changesets exist, create or update a release PR
2. when the release PR is merged and version updates land on `main`, publish changed packages to npm

The steady-state publish path should use npm Trusted Publisher with GitHub OIDC, not a long-lived npm token.

## Bootstrap Strategy

Trusted Publisher cannot be configured until the packages already exist on npm, so the first publication should happen manually from a local machine.

Bootstrap sequence:

1. prepare all target packages for publication
2. publish all intended packages locally to npm
3. use `--access public` where required for first public package publication
4. configure the GitHub Actions release workflow as a Trusted Publisher for each npm package
5. switch all subsequent releases to GitHub Actions with OIDC

This keeps the target release architecture clean and avoids permanent fallback logic for token-based publishing.

## Placeholder Packages

### `palamedes`

`palamedes` should be reserved now, but kept minimal. It should act as a lightweight placeholder package with documentation pointing users to the current package entry points.

It may optionally expose a tiny CLI message, but should not try to become a full product package in this iteration.

### `create-palamedes`

`create-palamedes` should also be reserved now, but remain a placeholder. It should not implement real scaffolding yet.

Its purpose in this iteration is to secure the package name and establish a clean path for future `pnpm create palamedes` support.

## Planned Changes

1. add `changesets` configuration for the pnpm workspace
2. add placeholder packages `packages/palamedes` and `packages/create-palamedes`
3. update workspace and package engine declarations to Node 24 where appropriate
4. add a CI workflow for build, test, and typecheck on Node 24
5. add a release workflow using `changesets/action`
6. perform one local bootstrap publish of all release packages
7. configure npm Trusted Publisher for the GitHub release workflow
8. remove `NPM_TOKEN` from the regular publish path

## Verification

Before the first bootstrap publish:

- `pnpm install`
- `pnpm build`
- `pnpm test`
- `pnpm check-types`
- inspect the packed contents of each publishable package
- verify `changesets` versioning in dry-run form

After Trusted Publisher is configured:

- merge a small follow-up release through the release PR flow
- confirm publishing succeeds from GitHub Actions without `NPM_TOKEN`

## Risks

- `@palamedes/core-node` may need extra publish validation because it ships a native artifact
- first-time npm publication may fail if package contents or access flags are incomplete
- adding placeholder packages now creates a small long-term maintenance burden, even if they stay minimal for a while
- Node 24 may surface compatibility issues in tooling that currently only runs against Node 20+
