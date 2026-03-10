# Palamedes Hard Rename Design

## Goal

Remove `-oxc` and `lingui` naming from the active Palamedes package surface and internal repo layout. This is a hard rename with no compatibility layer.

## Approved Naming

Package directories:

- `packages/extractor-oxc` -> `packages/extractor`
- `packages/transform` -> `packages/transform`
- `packages/vite-plugin` -> `packages/vite-plugin`
- `packages/next-plugin` -> `packages/next-plugin`

Published package names:

- `@palamedes/extractor`
- `@palamedes/transform`
- `@palamedes/vite-plugin`
- `@palamedes/next-plugin`

Public API names:

- `oxcExtractor` -> `extractor`
- `palamedes` -> `palamedes`
- `withPalamedes` -> `withPalamedes`
- `PalamedesPluginOptions` -> `PalamedesPluginOptions`
- `WithPalamedesOptions` -> `WithPalamedesOptions`

Loader files and subpath exports:

- `lingui-oxc-loader.cjs` -> `palamedes-loader.cjs`
- `palamedes-po-loader.cjs` -> `palamedes-po-loader.cjs`
- `./lingui-oxc-loader` -> `./palamedes-loader`
- `./palamedes-po-loader` -> `./palamedes-po-loader`

## Scope

- Rename package folders and update workspace references
- Rename public package names and internal workspace dependencies
- Rename exported symbols and example imports
- Rename loader files and subpath exports
- Update docs, examples, and visible package-name strings
- Leave implementation details that reference OXC as a technology choice intact

## Validation

- `pnpm install`
- `pnpm test`
- targeted build/type checks for renamed packages and examples as needed
- `rg` sweep for stale old names

## Intentional Breakage

- No alias exports
- No deprecated entry points
- No compatibility loader filenames
