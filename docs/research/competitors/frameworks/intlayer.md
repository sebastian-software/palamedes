---
title: Intlayer
category: frontend-framework
analyzed: 2026-07-26
analyzed_versions: "intlayer 9.0.1 (npm, published 2026-07-23); repo aymericzip/intlayer at clone time 2026-07-26"
homepage: https://intlayer.org
repository: https://github.com/aymericzip/intlayer
---

# Intlayer

## Fact sheet

| Fact              | Value                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| License           | Apache-2.0                                                                                                       |
| Analyzed version  | intlayer 9.0.1 (2026-07-23)                                                                                      |
| Company / funding | Single primary author (Aymeric Pineau, `aymericzip`); no funding disclosed in repo or docs — not verified        |
| Pricing           | Libraries free (Apache-2.0); hosted CMS/visual editor advertised as free — pricing page not fetched (403)        |
| Adoption          | ~76.8k npm downloads/week (`intlayer`); 789 GitHub stars, 121 forks, 14 open issues                              |
| Framework support | Very broad — see below; ~19 first-party adapter packages in the monorepo                                         |
| Message identity  | Explicit content keys, declared per component in `.content` declaration files                                    |
| ICU MessageFormat | Selectable, not default — `format: 'intlayer' \| 'icu' \| 'i18next' \| 'vue-i18n' \| 'po'`, default `'intlayer'` |
| .po / gettext     | Yes, as a selectable dictionary format (`'po'`)                                                                  |
| Extraction        | None — content is declared, not extracted; declaration files sit next to the component                           |
| Notable           | Per-component co-located dictionaries; dictionaries can be `local`, `remote`, or `hybrid` against a hosted CMS   |

## Snapshot

- Maintainer / company / funding: driven by a single primary author (Aymeric Pineau, GitHub `aymericzip`); the repository is under a personal account rather than an organisation. No funding, sponsorship or company entity was verified in this pass.
- First release / age: npm package created 2024-04-17; roughly 2.3 years old as of 2026-07-26. 383 published versions in that time — very high release velocity for the age.
- Current stable version: intlayer 9.0.1, published 2026-07-23 (three days before this analysis). A `canary` dist-tag exists (9.0.0-canary.21), so a prerelease channel is maintained alongside stable.
- Adoption: ~76.8k weekly downloads for the `intlayer` package (registry search API, 2026-07-26). 789 GitHub stars, 121 forks, 14 open issues — download count is high relative to star count, which is worth treating cautiously (many adapter packages depend on the core, and the monorepo publishes ~19 of them).
- License: Apache-2.0 throughout the repository — a genuine OSI licence, unlike General Translation's FSL.

## Positioning & target audience

- Positions as "Per-component Internationalisation solution for JS application. Type-Safe. Translate with AI. Edit Visually." — the three claims are co-location, TypeScript inference, and a visual editing surface.
- Targets developers who dislike both the central-JSON-namespace model and the extraction step: content lives in a declaration file beside the component that uses it, and nothing scans your source.
- Competes across an unusually wide front — the docs directory contains head-to-head comparison articles against vue-i18n, next-intl, i18next and others, in many languages, which is itself a marketing posture worth noting.

## Core concepts & architecture

- The unit is a **content declaration file** co-located with the component (`*.content.ts` and friends), exporting a dictionary with an explicit `key` and a `content` object.
- Translations are declared inline per locale via `t({ en: "Home", fr: "Accueil", es: "Inicio" })`, so all locales for a string sit in one place in the source tree by default — the inverse of a per-locale catalog file.
- There is **no extraction step**. Because content is declared rather than discovered, there is no source-scanning phase to optimise, and no drift between what is in the code and what is in the catalog. This is a genuinely different architecture from Palamedes, Lingui and React Intl, and it means extraction benchmarks are not a meaningful axis of comparison.
- Rich content helpers form a bespoke DSL rather than a message-format string: `plural` (CLDR categories via `Intl.PluralRules`), `enu` (enumeration over numeric ranges you define), `cond`, `gender`, `insert`, `nest`, `md`, `html`, `file`. Docs explicitly contrast `plural` (delegates to CLDR) against `enu` (hand-defined ranges).
- Message format is **configurable at project level**: `format?: 'intlayer' | 'icu' | 'i18next' | 'vue-i18n' | 'po'`, defaulting to `'intlayer'` (source: `packages/@intlayer/types/src/config.ts`). So ICU is reachable but is not the native or default vocabulary.
- Dictionaries carry a `location`: `'local'`, `'remote'`, `'hybrid'`, or `'plugin'`. Remote and hybrid dictionaries are synchronised with a hosted CMS, so the source-of-truth boundary is configurable per dictionary rather than fixed.

## Framework & platform support

- Adapter packages in the monorepo: `react-intlayer`, `next-intlayer`, `vue-intlayer`, `nuxt-intlayer`, `angular-intlayer`, `svelte-intlayer`, `solid-intlayer`, `preact-intlayer`, `lit-intlayer`, `astro-intlayer`, `react-native-intlayer`, `lynx-intlayer`, `vite-intlayer`, `vanilla-intlayer`, `react-scripts-intlayer`.
- Backend adapters: `express-intlayer`, `fastify-intlayer`, `hono-intlayer`, `adonis-intlayer`.
- This is a materially **broader** matrix than Palamedes (React and Solid across six meta-frameworks). Breadth of published adapters is not the same as depth of verification, and no equivalent of a browser-verified example matrix was found in this pass — but the surface claimed is wider, and that should be credited plainly.

## Catalog formats & interop

- Native format is Intlayer's own dictionary shape; `.po` is available as a selectable `format` value, as are `icu`, `i18next` and `vue-i18n`.
- Because declarations are co-located and locale-inline by default, the "handover artifact" for a translator is less obvious than a per-locale `.po` file; per-locale content declaration files are documented as an alternative layout.
- Whether the `'po'` format round-trips losslessly (msgctxt, plural forms, comments) was **not verified** in this pass — only that the format value exists in the config type.

## Workflow & tooling

- CLI (`intlayer-cli`), an LSP package (`@intlayer/lsp`), and an editor package (`intlayer-editor`) for the visual editing surface.
- Hosted CMS for `remote`/`hybrid` dictionaries; the README advertises the visual editor and CMS as free.
- Build-time missing-key detection and strict TypeScript types are advertised as core benefits; SEO helpers for hreflang and localised metadata are included.

## AI features

- "Translate with AI" is one of the three headline claims; an `@intlayer/engine` package exists in the monorepo alongside doc-review pipelines.
- Which model providers back the AI translation was **not verified** in this pass.

## Pricing

- Libraries are Apache-2.0 and free.
- The hosted CMS/visual editor is advertised as free in the README; the pricing page returned HTTP 403 to automated fetching, so no tier structure was verified. Treat commercial terms as **not verified**.

## Strengths

- No extraction step at all: content is declared, so there is no scanner to be fast or slow, and no possibility of a string existing in code but not in the catalog.
- Co-location genuinely reduces the "where does this string live" problem — the dictionary sits next to the component it serves.
- The widest first-party framework matrix of any project in this research set, front-end and back-end, from one codebase.
- Apache-2.0 throughout, with a real OSI licence rather than a source-available one.
- Format flexibility is unusual: a project can opt into ICU, i18next, vue-i18n or PO semantics rather than being locked to the house format.
- Very high release velocity and an active canary channel suggest real engineering throughput for a ~2-year-old project.

## Weaknesses & criticism

- Bus factor: a single primary author on a personal GitHub account, with no organisation, disclosed funding or visible co-maintainer structure found in this pass.
- The default message vocabulary is bespoke (`plural`/`enu`/`cond`/`gender`/`insert`/`nest`) rather than ICU. ICU is a configuration option, which means the portable-vocabulary guarantee depends on a project-level setting rather than being structural.
- Locale-inline declarations (`t({ en, fr, es })`) put every locale in the source tree by default, which scales awkwardly past a handful of languages and puts translator-facing content into files developers own.
- Explicit `key` fields on every dictionary mean the naming layer that source-string-first tooling removes is still present, just relocated from a central JSON tree to per-component files.
- No independent third-party reviews, critical write-ups or community post-mortems were found in this pass; the visible commentary is largely the project's own comparison articles. Assess as an early-stage project with limited external scrutiny.
- Docs contain a large volume of self-authored competitor-comparison content across many languages, some of it machine-translated — treat any Intlayer-authored benchmark or comparison as a vendor-interested source.
- 383 npm versions in ~2.3 years alongside a 9.x major implies frequent breaking-change churn; migration cost across majors was not assessed in this pass.

## What they do differently

- **Declaration instead of extraction.** Every other compile-time project in this set (Palamedes, Lingui, React Intl, Paraglide, next-intl's experimental path) scans source to discover messages. Intlayer inverts it: you write the dictionary, and the component imports it. That removes an entire class of tooling — and an entire class of tooling problems — at the cost of writing the declaration by hand.
- **Per-component co-location as the organising principle**, rather than per-locale catalogs or central namespaces.
- **Pluggable message format at project level**, so the same library can speak Intlayer, ICU, i18next, vue-i18n or PO semantics.
- **Per-dictionary source-of-truth**: `local`, `remote` or `hybrid` against a hosted CMS, decided dictionary by dictionary rather than for the whole project.
- **Breadth over depth in adapters**: ~19 first-party framework packages, including Lit, Lynx and four backend frameworks, from a project roughly two years old.

## Sources

- https://registry.npmjs.org/intlayer (live API, accessed 2026-07-26)
- https://registry.npmjs.org/-/v1/search?text=intlayer (download counts, live API, accessed 2026-07-26)
- https://github.com/aymericzip/intlayer (accessed 2026-07-26)
- https://github.com/aymericzip/intlayer — repository cloned at depth 1 and inspected directly (2026-07-26): `packages/` listing, `packages/@intlayer/types/src/config.ts`, `docs/docs/en/dictionary/*.md`
- https://intlayer.org (homepage; doc subpages returned HTTP 403 to automated fetching, accessed 2026-07-26)
