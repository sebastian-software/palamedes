# Next Loader Packaging Design

**Date:** 2026-03-10
**Status:** Approved
**Branch:** `t3code/plan-pofile-thin-ts-wrapper`

## Summary

`@palamedes/next` currently exports `./lingui-oxc-loader` and `./lingui-po-loader`, but the package does not actually contain these files.

The Next.js example and package consumers therefore fail during config loading before the build can even begin.

## Decision

Add real CommonJS loader files at the package root:

- `packages/nextjs-oxc/lingui-oxc-loader.cjs`
- `packages/nextjs-oxc/lingui-po-loader.cjs`

These files should be shipped as package assets and referenced by the existing `exports` map.

## Why This Approach

- matches the current package contract
- keeps the adapter structure simple
- avoids a larger redesign of the Next integration
- works for local workspace usage and published package usage

## Loader Responsibilities

### `lingui-oxc-loader.cjs`

- read webpack loader options
- run `transformLinguiMacros`
- return transformed code and source map

### `lingui-po-loader.cjs`

- read webpack loader options
- resolve Lingui config
- locate the current catalog
- compile `.po` input into JS via `@lingui/cli/api`
- propagate missing-translation and compilation errors

## Follow-Up

- verify `pnpm --filter @palamedes/next build`
- verify `pnpm --filter @palamedes/example-nextjs build`
- if Next still fails, fix remaining adapter/runtime issues separately
