# README Alignment Design

**Date:** 2026-03-11
**Status:** Approved
**Branch:** `main`

## Summary

Palamedes should align the root README and all package READMEs so they work both as npm landing pages and as current technical entry points.

The result should feel like one coherent product family: consistent structure, clearer package roles, stronger positioning, current implementation details, and a presentation layer that feels intentional rather than incidental.

## Scope

- rewrite the root README and all `packages/*/README.md` files
- align product positioning and package hierarchy across the repo
- update outdated technical claims and install guidance
- unify license and copyright language
- add a restrained set of useful badges
- embed the Palamedes logo where a stable asset is available

## Non-Goals

- rewriting the long-form docs in `docs/`
- changing package APIs or package metadata unless a README reveals an obvious contradiction
- adding a real scaffolding flow to `create-palamedes`
- inventing unsupported claims, benchmarks, or customer proof

## Decisions

- package READMEs should serve both discovery and technical validation
- the first screen of each README should answer "what is this?" and "when should I use it?"
- the root README should position Palamedes as a product family, not just a source repo
- framework adapter packages should read like primary user entry points
- lower-level packages should read like building blocks, not default starting points
- native target packages should explicitly say they are internal platform packages and not direct install targets
- placeholder packages should stay honest about their current status
- the writing should favor clarity, specificity, and product confidence over buzzwords

## Positioning Model

### Product-Level Positioning

Palamedes should be framed as modern i18n tooling for teams that want a faster, cleaner, more opinionated workflow, with Lingui mentioned only where compatibility or migration needs to be explicit.

Primary narrative:

- fast macro transforms
- fast extraction
- framework adapters for real app teams
- a thin runtime surface
- a native core under the hood where it matters

### Package Roles

- `@palamedes/vite-plugin`: primary starting point for Vite teams
- `@palamedes/next-plugin`: primary starting point for Next.js teams
- `@palamedes/cli`: operational CLI for extraction workflows
- `@palamedes/transform`: low-level transform engine
- `@palamedes/extractor`: low-level extraction engine
- `@palamedes/runtime`: small runtime support layer for transformed code
- `@palamedes/core-node`: Node wrapper around the native core
- `@palamedes/core-node-*`: internal platform packages for native delivery
- `palamedes`: reserved top-level package, not the main supported install path yet
- `create-palamedes`: reserved package for future scaffolding, not a full generator yet

## README Template

Each package README should follow the same broad structure:

1. Title
2. Short positioning statement
3. Badges
4. When to use this package
5. Installation
6. Minimal example
7. Key APIs or options
8. Relationship to other Palamedes packages
9. Status, limitations, or platform notes if needed
10. License / copyright

This structure should be adapted for package type, but not abandoned.

## Copy Principles

The text should use the same standards across the product surface:

- clear over clever
- specific over vague
- outcome-first framing where appropriate
- honest about maturity and limitations
- direct language that helps npm users decide quickly

Relevant marketing psychology principles for this pass:

- reduce ambiguity: quickly classify each package so users know if it is for them
- lower perceived risk: explain how packages fit together and where to start
- use social proof sparingly: badges can signal maintenance and legitimacy, but should not overwhelm
- use the default effect: make the recommended package choice obvious for common use cases

## Presentation Standards

### Badges

Badges should be limited to high-signal items:

- npm version
- license
- CI status

Additional badges are acceptable only if they clarify rather than decorate.

### Logo

The logo should be embedded in the root README and package READMEs if a stable brand asset is available.

Current implementation assumption:

- no local logo asset was found in the repository during design review
- implementation should either use an existing canonical remote asset already controlled by the project or defer logo embedding until such an asset exists

### License / Copyright

License and copyright language should be consistent across README files.

Preferred footer style:

- MIT license
- copyright attribution aligned to Sebastian Software GmbH

## Content Updates Needed

The current README set has several inconsistencies to fix:

- root README still references Node.js `>=20`
- some package READMEs are much richer than others
- `runtime`, `core-node`, native target packages, and placeholder packages are under-explained
- some READMEs still frame parts of the stack in older terms that do not reflect the current native-core direction
- package relationships are not consistently explained

## Package-Specific Guidance

### Root README

- present Palamedes as the umbrella product
- show the recommended starting points first
- summarize the package map
- keep the getting-started sections short and practical

### Plugin READMEs

- optimize for quick adoption
- treat these as the most user-facing package pages
- keep examples practical and minimal

### `transform` and `extractor`

- position them as low-level packages for custom integrations and advanced workflows
- avoid sounding like the default install path for most teams

### `runtime`

- explain why it exists in one sentence
- keep the API section short, but explicit

### `core-node`

- explain that it is the Node wrapper around the native core
- clearly explain the role of the platform packages

### Native Target Packages

- mark them as internal delivery packages
- tell users not to install them directly unless they are debugging distribution

### Placeholder Packages

- keep them honest and brief
- explain current status and the likely future role

## Verification

After the rewrite:

- each README should clearly identify the package role in its first screen
- package naming, positioning, and install guidance should be internally consistent
- Node version references should match current package support
- the root README should make it obvious where most users should begin
- placeholder and internal packages should not overpromise

## Risks

- over-polishing placeholder packages can create expectations the product does not yet meet
- reusing old README examples without checking current APIs can reintroduce stale guidance
- adding too many badges or visual elements can make the pages feel noisier rather than more trustworthy
