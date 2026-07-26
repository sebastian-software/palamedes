---
title: typesafe-i18n
category: frontend-framework
analyzed: 2026-07-26
analyzed_versions: "typesafe-i18n 5.27.1 (npm, published 2026-02-11); repo codingcommons/typesafe-i18n at clone time 2026-07-26"
homepage: https://github.com/codingcommons/typesafe-i18n
repository: https://github.com/codingcommons/typesafe-i18n
---

# typesafe-i18n

> **Verdict: out of scope for comparison pages.** The project is effectively
> dormant — see Activity below. The 2025 handover to `codingcommons` restarted
> CI and shipped one patch release, and development has not resumed since.
> A dormant project is not a competitor worth arguing against.
>
> **Note on handling.** The original author, Ivan Hofer, died in 2023; the README
> carries a memorial. The activity data below is recorded because cadence and
> maintainership are legitimate considerations when assessing a dependency. It is
> **not** material for competitive marketing. This project must not be given a
> landing page, and its maintenance situation must not be used as a talking point
> on any page. It is excluded from `/compare` entirely — not mentioned, not
> ranked, not used as a foil.

## Fact sheet

| Fact              | Value                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| License           | MIT                                                                                             |
| Analyzed version  | typesafe-i18n 5.27.1 (2026-02-11)                                                               |
| Company / funding | Community project under the `codingcommons` GitHub organisation; GitHub Sponsors link in README |
| Pricing           | Free OSS; no commercial offering                                                                |
| Adoption          | ~51.6k npm downloads/week; 266 published versions since 2021-02-14                              |
| Framework support | TypeScript core plus adapters for React, Svelte, Vue, Angular, SolidJS, Node.js, browser/CDN    |
| Message identity  | Keys in typed dictionary objects                                                                |
| ICU MessageFormat | No — own interpolation syntax with typed arguments                                              |
| .po / gettext     | No                                                                                              |
| Extraction        | Generator watches dictionaries and emits TypeScript types; no source scanning                   |
| Notable           | Zero runtime dependencies; ~1 kB core, sizes published per entry point                          |

## Snapshot

- Maintainer / history: created by Ivan Hofer (1995–2023). The repository moved from `ivanhofer/typesafe-i18n` to the `codingcommons` organisation, where a small group restarted CI in October 2025.
- First release / age: npm package created 2021-02-14; ~5.5 years old as of 2026-07-26, with 266 published versions — almost all of them before August 2023.
- Current stable version: 5.27.1, published 2026-02-11.
- Adoption: ~51.6k weekly downloads (registry search API, 2026-07-26). A substantial installed base, but on a codebase that has barely moved since 2023.
- Zero runtime dependencies; the only peer dependency is `typescript >= 3.5.1`.

## Activity (verified 2026-07-26, full git history + npm `time` field)

The project is **effectively dormant**. This is the decisive fact about it.

Commits per year on `main`:

| Year | Commits                                     |
| ---- | ------------------------------------------- |
| 2020 | 62                                          |
| 2021 | 879                                         |
| 2022 | 494                                         |
| 2023 | 147 (last commit by Ivan Hofer: 2023-08-25) |
| 2024 | **0**                                       |
| 2025 | 4                                           |
| 2026 | 6 (most recent: 2026-02-11)                 |

Release history at the boundary: `5.26.2` on **2023-08-25**, then a gap of almost
two and a half years, then `5.27.0` and `5.27.1` on **2026-02-11**. Nothing in the
5.5 months since.

What the ten post-handover commits actually contain: GitHub Actions upgrades
(`checkout@v4`, `setup-node@v4`, `pnpm/action-setup@v4`), an artifact-upload CI fix,
Node 24 in CI, `release-please` setup, an npm-provenance repository-metadata fix,
a tribute commit for Ivan Hofer (2025-10-09), and exactly **one** functional change
— `feat: add support for bun lockfile` (2025-10-23).

So the handover restored the build and shipped the backlog as a patch release. It
did not resume development. The repository is not archived and carries no
deprecation notice, but on this evidence it should be treated as unmaintained for
the purpose of choosing a new dependency.

## Positioning & target audience

- Positions as "an opinionated, full type-safe, lightweight localization library for TypeScript projects with no external dependencies."
- Targets TypeScript-first teams for whom compile-time guarantees about message arguments matter more than ICU compliance or catalog interop.
- The pitch is size and type safety, in that order: published gzipped sizes for each entry point, and generated types that make a missing or mistyped interpolation argument a compile error.

## Core concepts & architecture

- Dictionaries are plain typed objects. A generator watches them and emits TypeScript types, so argument names, counts and types are checked at compile time at every call site.
- Interpolation uses its own curly-brace syntax with typed arguments and named formatters, rather than ICU MessageFormat.
- Plural handling is supported and backed by the platform `Intl.PluralRules` for CLDR categories.
- Parsing of a translation's variables and formatters is deferred to first access and then cached in an optimised object — a deliberate runtime-size and startup tradeoff.
- Published sizes (gzipped, from the README): `i18nString` 948 B, `i18nObject` 1089 B, `i18n` 1119 B; framework adapters 1230–1602 B.

## Framework & platform support

- TypeScript and JavaScript core, with documented support for React and Next.js, Svelte and SvelteKit, Vue and Nuxt, Angular, SolidJS, Node.js backends and scripts, and browser use via CDN.
- No React Server Components story was found in this pass — not verified either way.

## Catalog formats & interop

- No `.po`, XLIFF or ICU interchange. Dictionaries are TypeScript/JavaScript objects, so the handover artifact for a translator is a source file rather than a standard catalog.
- Integration with external translation services was listed as a long-term goal in the project's own roadmap discussion (2022), not as a shipped capability.

## Workflow & tooling

- A generator/watcher regenerates types as dictionaries change; this is the core developer loop.
- No extraction from source: the dictionary is authored, and the types follow from it.

## AI features

- None found.

## Pricing

- Free, MIT, no commercial offering. A GitHub Sponsors link is present in the README.

## Strengths

- The strongest compile-time argument-safety story of any library in this research set: interpolation arguments are typed, so a wrong or missing argument fails the build rather than the render.
- Genuinely tiny — around 1 kB for the core, with per-entry-point sizes published rather than claimed in the aggregate.
- Zero runtime dependencies, which is rare and materially reduces supply-chain surface.
- Broad framework adapter coverage for a library of this size, including Svelte, Vue, Angular and SolidJS.
- MIT licensed, with a substantial installed base (~51.6k downloads/week) and no deprecation notice.

## Weaknesses & criticism

- **Dormant.** See Activity: zero commits in 2024, ten since, one of them functional. The library works, but nothing is being built on it.
- No ICU MessageFormat, and no `.po`/XLIFF interop, so the translation supply chain is narrower than for catalog-based tooling — dictionaries are source files, and handing them to an agency means handing over TypeScript.
- No React Server Components support was found, and given the activity level none is likely to arrive.
- The roadmap ambitions recorded in the project's own 2022 long-term-goals discussion (external translation services, collaboration tooling for non-technical translators, build-time optimisations) remain unrealised and now almost certainly will not be delivered.
- **Deliberately not recorded as a competitive weakness:** the circumstances behind the change in cadence. The original author's death is context for anyone assessing the dependency and belongs in this file. It must never be used as comparison-page material, and this project gets no landing page — see the note at the top.

## What they do differently

- **Types as the product.** Other libraries treat TypeScript support as a feature; here the generator and the emitted types are the central mechanism, and everything else is arranged around keeping them accurate.
- **Size as a first-class, per-entry-point published number** rather than a marketing aggregate.
- **Zero dependencies as a hard constraint**, not an aspiration.
- **No catalog format at all**: the dictionary is TypeScript, which maximises type fidelity and minimises industry interop — an explicit trade in the opposite direction from gettext-based tooling.

## Sources

- https://registry.npmjs.org/typesafe-i18n (live API, accessed 2026-07-26)
- https://registry.npmjs.org/-/v1/search?text=typesafe-i18n (download counts, live API, accessed 2026-07-26)
- https://github.com/codingcommons/typesafe-i18n — repository cloned with full history and inspected directly (README, `git log` commit-per-year counts and post-handover commit list) 2026-07-26
- https://github.com/codingcommons/typesafe-i18n/discussions/324 ("Long-term goals of typesafe-i18n", authored 2022-05-29, accessed 2026-07-26)
- https://github.com/codingcommons/typesafe-i18n/discussions (maintainership transition referenced in search results, thread not fetched — accessed 2026-07-26)
