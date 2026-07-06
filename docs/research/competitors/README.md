# Competitive analysis — raw research notes

Condensed, factual snapshots of i18n frameworks and translation management
systems (TMS) adjacent to Palamedes. The goal is to understand **what others do
differently** — not marketing material. Keep entries raw and sourced.

## Methodology

- Snapshot date: **2026-07-06** (each file records its own `analyzed` date and
  the exact `analyzed_versions` in the frontmatter — re-verify before citing).
- Data gathered from official docs/pricing pages, npm registry
  (`registry.npmjs.org`, download counts via `api.npmjs.org`), GitHub, and
  independent commentary (issues, HN/Reddit, review sites).
- Numbers that could not be verified against a fetched source are marked
  "not verified".
- Every file ends with a source list including access dates.
- Research performed by web-research agents; spot-check before relying on a
  specific number.

## Structure

Two structurally separate groups, because they compete with different parts of
Palamedes:

- **[frameworks/](frameworks/README.md)** — pure technology: libraries,
  frameworks, and compile-time tooling. These compete with the open-source
  core of Palamedes.
- **[business/](business/README.md)** — vendors shipping a software solution
  (TMS / localization platforms, hosted or self-hosted). These are relevant
  later for a commercial "Palamedes Plus" offering. Weblate sits here despite
  being GPLv3/libre because it is a TMS product, not a runtime library; Tolgee
  and General Translation are hybrids (vendor platform + own SDKs) and are
  filed by their vendor/platform nature.

Each group has its own README with a **side-by-side comparison table** of the
hard facts (license, pricing model, adoption, ICU/.po support, source of
truth, AI orientation, …). Each dossier starts with the same facts as a
per-product **fact sheet** table, followed by the shared section layout
(Snapshot, Positioning, Architecture, Formats, Workflow, AI, Pricing,
Strengths, Weaknesses, **What they do differently**, Sources). The "What they
do differently" section is the payload; everything else is supporting
evidence.

## Analyzed products

### frameworks/ — libraries & tooling (compete with the OSS core)

| File                                                        | Product                          | One-liner (as of 2026-07-06)                                                                                                                                                                                                                   |
| ----------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [lingui.md](frameworks/lingui.md)                           | Lingui (v6.5.0)                  | Closest architectural relative: macro extraction, .po-first, multi-framework bindings; v6 was a hard ESM-only break that changed message-ID encoding; Open-Collective-funded; ships "Agent Skills" for AI coding agents.                       |
| [i18next.md](frameworks/i18next.md)                         | i18next (v26.3.4)                | Key-based runtime-plugin architecture; own interpolation format (ICU only via replacement plugin); funded via its own SaaS (locize) incl. the v25.8 console-ad backlash; extraction being rewritten in Rust (`i18next-cli`).                   |
| [next-intl.md](frameworks/next-intl.md)                     | next-intl (v4.13.1)              | Next.js-only, ICU + key-based JSON; new experimental `useExtracted` compiles source-string authoring down to hash keys at build time ("Tailwind-inspired", AI-agent-motivated); ~4M weekly downloads on a single-maintainer sponsorship model. |
| [formatjs-react-intl.md](frameworks/formatjs-react-intl.md) | FormatJS / react-intl (v10.1.14) | ICU standard-bearer; message IDs are content hashes of default messages; extract→compile pipeline with AST precompilation; no native RSC support.                                                                                              |
| [paraglide-inlang.md](frameworks/paraglide-inlang.md)       | Paraglide JS / inlang (v2.20.2)  | Compile-time codegen to tree-shakable per-message functions, zero runtime library; reload-on-locale-switch by design; `.inlang` project format as ecosystem bet (Sherlock/Fink); MIT, no visible monetization.                                 |
| [vue-i18n.md](frameworks/vue-i18n.md)                       | Vue I18n / Intlify (v11.4.6)     | Own non-ICU message DSL; SFC-local `<i18n>` blocks; AOT-vs-JIT compilation toggle (CSP); official `petite-vue-i18n` lite package; Vue/Nuxt-only.                                                                                               |

### business/ — commercial solution vendors (relevant for Palamedes Plus)

| File                                                      | Product                           | One-liner (as of 2026-07-06)                                                                                                                                                                                                                        |
| --------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [crowdin.md](business/crowdin.md)                         | Crowdin                           | Hosted project DB is source of truth (git is a sync target); "hosted words" pricing (source words × target languages); AI context harvesting (website crawler, source-code CLI); active MCP server v2 for Claude Code; built-in vendor marketplace. |
| [locize.md](business/locize.md)                           | locize                            | Runtime CDN delivery instead of build-time catalogs; missing-key harvesting from the running app (`saveMissing`) instead of static extraction; SaaS explicitly funds i18next OSS; multidimensional usage pricing (words/modifications/downloads).   |
| [general-translation.md](business/general-translation.md) | General Translation (gt-next v11) | AI-first, vertically integrated: `<T>` wraps whole JSX blocks as translation units; Locadex agent opens migration PRs; dev = live AI translation, prod = pre-generated CDN; SDKs are FSL source-available (not OSS); ~2 years old.                  |
| [tolgee.md](business/tolgee.md)                           | Tolgee (platform v3.209.1)        | Open-core self-hostable TMS with ALT+click in-context editing and automatic screenshot capture as AI context; own SDK stack (not i18next-based); free self-host tier up to 10 seats.                                                                |
| [phrase.md](business/phrase.md)                           | Phrase                            | Enterprise suite (Strings+TMS+Language AI+Orchestrator); hosted key DB is system of record; QPS AI quality score gates human review and TM hygiene; PE-owned (Carlyle); multi-dimensional platform pricing incl. MTUs.                              |
| [lokalise.md](business/lokalise.md)                       | Lokalise                          | Since 11/2025 billed on processed words/year instead of seats; two-tier AI (Standard vs. RAG-based Pro AI) plus AI LQA scoring (DQF-MQM); translation branches + OTA delivery; now Adobe-owned via Semrush.                                         |
| [transifex.md](business/transifex.md)                     | Transifex                         | "Native"/CDS delivers translations over the air at runtime, no catalogs in the repo; word-pair metering; AI words as separate SKU; OSS exodus to Weblate documented (Fedora ecosystem, 2025); ownership churn (PARC→XTM).                           |
| [weblate.md](business/weblate.md)                         | Weblate (2026.7)                  | Git repo is the actual source of truth — translators' edits flow back as real commits/PRs ("lazy commits"); bilingual .po semantics preserved; 50+ formats, 30+ QA checks; GPLv3, gratis hosting for libre projects.                                |

## Candidates for future rounds

- Fluent (Mozilla) / @fluent/bundle — message-format innovation
- typesafe-i18n, intlayer, gettext ecosystem tooling
- POEditor, Weglot (proxy-based), Localazy, SimpleLocalize
