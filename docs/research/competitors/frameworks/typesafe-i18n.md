---
title: typesafe-i18n
category: frontend-framework
analyzed: 2026-07-26
analyzed_versions: "typesafe-i18n 5.27.1 (npm, published 2026-02-11); repo codingcommons/typesafe-i18n at clone time 2026-07-26"
homepage: https://github.com/codingcommons/typesafe-i18n
repository: https://github.com/codingcommons/typesafe-i18n
---

# typesafe-i18n

> **Note on this dossier.** The library's original author, Ivan Hofer, died in 2023;
> the README carries a memorial. Maintenance has since continued under the
> `codingcommons` organisation. The facts below are recorded because release
> cadence and maintainership are legitimate technical considerations for anyone
> choosing a dependency. They are **not** material for competitive marketing, and
> the project should not appear on a public comparison page framed around
> maintainer risk or "what that costs you". See the note in the Weaknesses
> section.

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

- Maintainer / history: created by Ivan Hofer (1995–2023). The repository moved from `ivanhofer/typesafe-i18n` to the `codingcommons` organisation, where maintenance continues with multiple contributors; a maintainership announcement was posted in the org's discussions around October 2025 (referenced in search results; the specific thread was not fetched in this pass — treat the exact date as not verified).
- First release / age: npm package created 2021-02-14; ~5.5 years old as of 2026-07-26, with 266 published versions.
- Current stable version: 5.27.1, published **2026-02-11** — roughly 5.5 months before this analysis. The most recent commit on `main` at clone time is the release commit for that version, authored by the release bot. Cadence is slow but the project is not archived and carries no deprecation notice.
- Adoption: ~51.6k weekly downloads (registry search API, 2026-07-26) — a substantial installed base.
- Zero runtime dependencies; the only peer dependency is `typescript >= 3.5.1`.

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

- Release cadence is slow: the most recent release predates this analysis by about 5.5 months, against a project that once shipped frequently.
- No ICU MessageFormat, and no `.po`/XLIFF interop, so the translation supply chain is narrower than for catalog-based tooling — dictionaries are source files, and handing them to an agency means handing over TypeScript.
- The roadmap ambitions recorded in the project's own 2022 long-term-goals discussion (external translation services, collaboration tooling for non-technical translators, build-time optimisations) remain largely unrealised.
- **Deliberately not recorded as a competitive weakness:** the circumstances of the maintainership change. The original author's death is a fact that explains the repository move and the change in cadence, and it belongs in this file as context for anyone assessing the dependency. It must not be used as comparison-page material, and the project should not be given a landing page whose structure requires arguing what its maintenance situation "costs you".

## What they do differently

- **Types as the product.** Other libraries treat TypeScript support as a feature; here the generator and the emitted types are the central mechanism, and everything else is arranged around keeping them accurate.
- **Size as a first-class, per-entry-point published number** rather than a marketing aggregate.
- **Zero dependencies as a hard constraint**, not an aspiration.
- **No catalog format at all**: the dictionary is TypeScript, which maximises type fidelity and minimises industry interop — an explicit trade in the opposite direction from gettext-based tooling.

## Sources

- https://registry.npmjs.org/typesafe-i18n (live API, accessed 2026-07-26)
- https://registry.npmjs.org/-/v1/search?text=typesafe-i18n (download counts, live API, accessed 2026-07-26)
- https://github.com/codingcommons/typesafe-i18n — repository cloned at depth 1 and inspected directly (README, git log) 2026-07-26
- https://github.com/codingcommons/typesafe-i18n/discussions/324 ("Long-term goals of typesafe-i18n", authored 2022-05-29, accessed 2026-07-26)
- https://github.com/codingcommons/typesafe-i18n/discussions (maintainership transition referenced in search results, thread not fetched — accessed 2026-07-26)
