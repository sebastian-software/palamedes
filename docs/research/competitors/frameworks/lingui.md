---
title: Lingui
category: frontend-framework
analyzed: 2026-07-06
analyzed_versions: "@lingui/core 6.5.0 (latest, published 2026-07-06); v6.0.0 released 2026-04-22; v5.9.5 was last v5 release (2026-04-06); 6.0.0-next.0..next.4 prereleases Feb-Apr 2026"
homepage: https://lingui.dev
repository: https://github.com/lingui/js-lingui
---

# Lingui

## Fact sheet

| Fact              | Value                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| License           | MIT                                                                                                                  |
| Analyzed version  | @lingui/core 6.5.0 (2026-07-06)                                                                                      |
| Company / funding | Community project; Open Collective donations (low four figures)                                                      |
| Pricing           | Free OSS; no commercial offering                                                                                     |
| Adoption          | ~1.29M npm downloads/week (@lingui/core); 5.8k GitHub stars                                                          |
| Framework support | React (incl. RSC), React Native, Vue 3, SolidJS, vanilla JS; community: Astro, Svelte                                |
| Message identity  | Source-string-derived auto-IDs or explicit custom IDs (developer's choice)                                           |
| ICU MessageFormat | Yes — native                                                                                                         |
| .po / gettext     | Yes — first-class catalog format                                                                                     |
| Extraction        | Static compile-time (macros, Babel/SWC), extract → compile pipeline                                                  |
| AI                | No built-in MT/AI; ships "Agent Skills" + llms.txt for AI coding agents                                              |
| Notable           | Closest architectural relative to Palamedes; v6 (2026-04) was a hard ESM-only break with changed message-ID encoding |

## Snapshot

- Maintainer / company / funding: Community project, fiscal host Open Source Collective. Admins: Tomáš Ehrlich (original creator, 2017), Sergio Moreno, plus "Sergey" and "Olena". Not owned by a single company. Sponsors on Open Collective: Translation.io ($2,400), Crowdin ($1,300), Sector Labs ($1,000), plus ~6 small individual backers (largest $135). Total OC balance not disclosed on the page.
- License: MIT
- Current stable version + release date: 6.5.0, published 2026-07-06 (same day as this analysis — brand new). v6.0.0 shipped 2026-04-22.
- Adoption (npm weekly downloads, week of 2026-06-29 to 2026-07-05):
  - @lingui/core: 1,292,528
  - @lingui/react: 825,598
  - @lingui/cli: 765,619
  - @lingui/macro: 311,901 (legacy package, officially unmaintained since v6 — see below; downloads persist from apps still on v5 or not yet migrated to `@lingui/react/macro` / `@lingui/core/macro`)
  - GitHub: 5,804 stars, 445 forks, 58 open issues, 257 mentionable users (contributor pool proxy)
- First release / age: repo created 2017-01-17 (~9.5 years old as of 2026); originally "LinguiJS."

## Positioning & target audience

- Self-described: "a readable, automated, and optimized (2 kb) internationalization for JavaScript." Marketing tagline: "Internationalization Framework for Global Products."
- Targets JS/TS developers across React, React Native, Vue, SolidJS, vanilla JS, Node — not React-only, unlike react-intl/react-i18next framing.
- Pitches itself on bundle size, ICU MessageFormat correctness, and inline/co-located message authorship (vs. manual key-JSON management).
- Explicit doc pages comparing itself to i18next and react-intl (competitive positioning baked into docs).

## Core concepts & architecture

- Message identity: supports both explicit custom IDs (`t({id: "custom.id", message: "..."})`) and auto-generated IDs derived from the source string — "unopinionated," developer's choice. In v6, auto-generated IDs switched to URL-safe Base64 (RFC 4648), a breaking change requiring catalog key rewrites for existing PO/JSON/CSV catalogs.
- Message format: ICU MessageFormat under the hood ("battle-tested and powerful"); `Plural` and `Select` components/macros produce syntactically valid ICU output.
- Extraction/compilation pipeline: static-analysis extractor (Babel-based by default; SWC plugin available) scans source for macro calls (`t`, `Trans`, `Plural`) and non-macro runtime calls (`i18n.t()`, `i18n._()` — extracted but macros are the recommended path). Only statically-defined messages extract; dynamic/variable message content is not extracted. Compilation step turns catalogs into optimized JS modules per locale.
- Macros: `t` (tagged template / function), `<Trans>` component, `ph()` for named placeholders (replacing positional `{0}` with semantic `{name}`), `/* lingui-extract-ignore */` and `/* lingui-set */` / `/* lingui-reset */` directives for extraction control.
- Runtime model: `@lingui/core` is framework-agnostic — loads compiled catalogs, tracks active locale, formats via ICU. Framework bindings (`@lingui/react`, `@lingui/solid`, community Astro/Svelte adapters) sit on top.
- SSR/RSC: dedicated tutorial for React Server Components; TanStack Start example added in v6. Next.js App Router support has GitHub issues around dynamic routing limitations (extraction can't find text in dynamically-routed segments — issue #2183).
- Type safety: "Typed Message IDs" shipped as a feature in 6.2.0 (2026-06-01); stricter TypeScript nullability handling introduced in v6 (extracted vs. loaded message types now distinguished; code should check `undefined` not `null`).
- Bundle size: docs/README claim ~2 kb for core; Open Collective project description separately says "5 kb" — inconsistent claims across Lingui's own properties. Third-party comparison (npm-compare) cites ~3 kb gzipped for LinguiJS vs ~13 kb react-intl vs ~8-20 kb react-i18next+plugins.
- Install footprint: v6 reduced combined install size of core packages from 62 MB to 35 MB (-44%) and transitive deps from 146 to 104 packages, by dropping dual ESM/CJS builds.
- CLI performance: v6 added worker-thread multithreading across `extract`, `compile`, `extract-template`, `extract-experimental` (configurable via `--workers`, default = CPU cores − 1, capped at 8).

## Framework & platform support

- Officially documented: React (incl. Server Components), React Native, Vue 3 (with Reactivity Transform support via `createVueExtractor()`, v6), SolidJS (native integration added in v6.4.0, 2026-06-16), vanilla JS/Node.
- Community-maintained: Astro, Svelte adapters (not first-party).
- Build tooling: Vite plugin (Vite 6.3+ through Vite 8 supported in v6), Webpack, Babel, SWC plugin, and experimental Rolldown support (added 6.5.0, via pluggable bundler interface in the experimental extractor).
- Node.js: v6 requires Node ≥22.19 (ESM-only distribution, dropped CommonJS entirely except `@lingui/metro-transformer` which stays dual for React Native/Metro compatibility).
- Astro integration requested since 2023 (issue #1640, 14 reactions) — still not first-party as of v6.5.0.

## Catalog formats & interop

- Native formats: PO (gettext), JSON, CSV, plus a pluggable formatter API (`formatter()` from packages like `@lingui/format-po`) for custom formats. YAML config format was removed in v6 (JS/TS/JSON only now).
- TMS integrations documented: Crowdin (dedicated docs page, CLI-based `sync:sources`/`sync:translations`, OTA content delivery, GitHub/GitLab/Bitbucket auto-sync) and Translation.io (a financial sponsor).
- v6 message-ID format change (Base64 URL-safe encoding) requires manual catalog key migration for existing JSON/CSV/PO-Gettext catalogs when upgrading from v5.

## Workflow & tooling

- Standard cycle: Define → Extract → Translate → Compile → Deploy.
- CLI: `lingui extract`, `lingui compile`, `extract-template`, experimental `extract-experimental` (dependency-tree-crawling mode for multi-page apps, builds page-specific catalogs instead of scanning everything).
- v6.5.0 added configurable pseudo-localization options (`--pseudolocalize` type feature, added as "pseudolocalize options").
- v6.3.0 added `BatchExtractor` CLI support.
- Open issues indicate workflow gaps still unresolved as of analysis date: no built-in "fail CI on missing translations" flag by default in some flows (#2195, "Add a command to check for missing translations," open, 8 reactions); no non-zero exit code on extraction/validation failures was a long-standing ask (#1419/#1420, closed since — folded into recent releases per changelog patterns, not independently reconfirmed).
- PO catalog diff noise was a recurring complaint — v6 addressed part of this via configurable JSX placeholder names (`jsxPlaceholderAttribute`, `jsxPlaceholderDefaults`) and `ph()` named placeholders, explicitly to "reduce catalog diff noise." Open issue #2405 ("Reduce PO catalog comments changes for cleaner source control," 4 reactions) shows this is still only partially solved.

## AI features

- `llms.txt` and `llms-full.txt` published at lingui.dev, following the emerging llms.txt convention for LLM-context-optimized docs.
- Separate `lingui/skills` GitHub repo: "Agent Skills" — packaged procedural knowledge for AI coding assistants (Claude Code-style skills) covering Lingui best practices/patterns, positioned as reducing hallucinated API usage.
- No built-in AI/MT translation engine in Lingui core itself; AI-assisted translation happens via context-rich message descriptions consumed by external tools, or via TMS partners (Crowdin/Translation.io) that have their own AI/MT features.
- GitHub discussion open on "Automatic LLM Translations" (#2342) — not yet a shipped first-party feature as of v6.5.0.

## Pricing

- Lingui itself: fully free/OSS (MIT), no paid tier, no enterprise plan, no commercial hosted offering from the Lingui project itself.
- Revenue model is donation-based via Open Collective (small sponsor/backer amounts, see Snapshot) — no evidence of a sustainable full-time-maintainer funding model.
- Paid costs only arise from third-party TMS integrations (Crowdin, Translation.io) that users may optionally pair with Lingui; those have their own separate commercial pricing not set by Lingui.
- Not to be confused with "Lingo.dev" (different product, has its own commercial pricing) — search results show these are frequently conflated.

## Strengths

- Long track record (9+ years, since 2017), predates most modern React i18n tooling.
- Small claimed runtime footprint and lean v6 dependency tree (35 MB installed vs 62 MB pre-v6).
- Genuine multi-framework support (React, Vue, SolidJS, React Native) rather than React-only.
- Standard ICU MessageFormat compliance, PO/gettext-native catalogs (interoperable with existing translator tooling).
- Active release cadence: 6 minor releases between v6.0.0 (Apr 2026) and v6.5.0 (Jul 2026), roughly monthly.
- CLI worker-thread parallelism and experimental Rolldown/dependency-tree-crawling extraction show ongoing investment in build performance at scale.

## Weaknesses & criticism

- Funding is thin and informal: total disclosed OC sponsorship is low four figures from three sponsors plus a handful of small individual backers — no evidence of paid full-time maintenance capacity, unlike VC-backed alternatives.
- v6 is a disruptive breaking-change release: ESM-only (drops CommonJS), Node ≥22.19 requirement, removed YAML config, removed deprecated Intl wrappers, changed auto-generated message ID encoding (requires manual catalog rewrites) — real migration cost for existing v5 users just weeks/months after v6 shipped (v6.0.0 on 2026-04-22, this analysis on 2026-07-06).
- `@lingui/macro` package explicitly marked "no longer maintained" in v6 migration guide, yet still pulls ~312k weekly downloads — signals a nontrivial population of apps on old patterns that must migrate to `@lingui/react/macro` / `@lingui/core/macro`.
- Framework-support gaps acknowledged by the community itself: Astro integration requested since 2023, still not first-party 3+ years later (#1640); Next.js App Router dynamic-route extraction limitation open since 2025 (#2183).
- PO catalog diff/comment noise on every extraction was a long-running pain point; only partially mitigated in v6, still open as of #2405.
- Smaller ecosystem/community than i18next per third-party comparisons — fewer TMS integrations, smaller plugin surface, less "tutorial density" than the react-i18next ecosystem.
- Inconsistent bundle-size marketing across its own properties: GitHub README says "2 kb," Open Collective project description says "5 kb" for the same library — not verified which is current/accurate.
- Extraction is strictly static-analysis based: any dynamically constructed message/key is silently not extracted, a common trip-up flagged in docs itself as a limitation developers must work around.

## What they do differently

- Framework-agnostic core with genuinely separate framework bindings (React, Vue, SolidJS, React Native) rather than a React-first library with ports bolted on — broader multi-framework ambition than react-intl/react-i18next.
- Macro-based, compile-time extraction from source code (tagged templates/JSX components) rather than a runtime-key convention — messages are co-located with UI code and the source string usually _is_ the default value, closer to gettext-style workflows than to i18next's flat-JSON-key convention.
- Native PO/gettext catalog support as a first-class format (not bolted on), explicitly courting teams whose translators already use gettext-based CAT tools.
- Took on an unusually disruptive breaking-change major version in 2026 (ESM-only, dropped CJS, changed ID encoding, removed YAML config) purely for "modernization" — a deliberate bet that the ecosystem (bundlers, Node runtime `require(esm)` support) has matured enough to justify forcing all users through a hard migration, rather than maintaining a slow-deprecation path.
- CLI-level architectural investment (worker-thread parallel extraction, pluggable bundler interface for experimental Rolldown-based extraction, dependency-tree-crawling catalog splitting) — treats the build/tooling pipeline itself as a performance-engineering target, not just the runtime.
- Ships "Agent Skills" as a first-party artifact (separate `lingui/skills` repo) specifically to make AI coding agents use the library correctly — an explicit bet on AI-assisted development as a primary consumption path going forward, ahead of shipping any actual AI/MT translation feature in the core product itself.

## Sources

(all accessed 2026-07-06)

- https://lingui.dev — homepage
- https://registry.npmjs.org/@lingui/core/latest — version/license
- https://registry.npmjs.org/@lingui/core (full version/time history)
- https://api.npmjs.org/downloads/point/last-week/@lingui/core
- https://api.npmjs.org/downloads/point/last-week/@lingui/react
- https://api.npmjs.org/downloads/point/last-week/@lingui/cli
- https://api.npmjs.org/downloads/point/last-week/@lingui/macro
- https://github.com/lingui/js-lingui — repo stats via `gh api repos/lingui/js-lingui`
- https://github.com/lingui/js-lingui/releases — release history via `gh api repos/lingui/js-lingui/releases`
- https://github.com/lingui/js-lingui/blob/main/CHANGELOG.md
- https://lingui.dev/introduction
- https://lingui.dev/guides/message-extraction
- https://lingui.dev/blog/2026/04/22/announcing-lingui-6.0
- https://lingui.dev/releases/migration-6
- https://lingui.dev/tools/crowdin
- https://opencollective.com/js-lingui
- https://github.com/lingui/skills
- GitHub issue search via `gh api search/issues` (repo:lingui/js-lingui), sorted by reactions
- https://www.auto18n.com/en/blog/react-i18n-2026 (third-party comparison, bundle size figures)
- https://npm-compare.com/@lingui/macro,react-i18next,react-intl (third-party comparison)
- https://tolgee.io/blog/react-i18n-libraries-comparison (third-party comparison, mentioned in search results, not independently fetched in full)
