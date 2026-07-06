---
title: Paraglide JS / inlang
category: hybrid
analyzed: 2026-07-06
analyzed_versions: "@inlang/paraglide-js@2.20.2 (npm, published 2026-06-25); inlang project format / inlang SDK (unversioned, live docs as of 2026-07-06); Sherlock VS Code extension (marketplace listing, 2026-07-06)"
homepage: https://inlang.com
repository: https://github.com/opral/paraglide-js
---

# Paraglide JS / inlang

## Snapshot

- Maintainer / company / funding: Opral (GmbH), founded August 2022, Berlin. ~7 employees. No funding rounds found (per Tracxn aggregator profile — not confirmed via a primary source such as a press release; treat as moderately confident, not verified). Founder listed as Samuel Stroschein (per aggregator sites theorg.com / f4.fund — not confirmed via a primary Opral source).
- License: MIT (verified via npm registry `license` field and GitHub API `license.spdx_id` for `opral/paraglide-js`).
- Current stable version + release date: `@inlang/paraglide-js@2.20.2`, published **2026-06-25** (npm registry `time` field, live API pull). Release cadence roughly weekly-to-biweekly (2.16.0 on 2026-04-14 through 2.20.2 on 2026-06-25 = 10 releases in ~10 weeks). No GitHub Releases are tagged for this repo — versioning is tracked via npm + `CHANGELOG.md` only.
- Adoption (live-pulled 2026-07-06, treat as authoritative over cached/marketing figures):
  - npm weekly downloads: **358,346** (week 2026-06-29–2026-07-05, via `api.npmjs.org/downloads/point/last-week/@inlang/paraglide-js`); monthly ≈ **1,427,718**.
  - GitHub stars: **538** (`opral/paraglide-js`, live API), 21 forks, 31 open issues.
  - Note: paraglidejs.com's own marketing page shows stale/cached lower figures (~442 stars, ~303,000 weekly downloads) — live API numbers above supersede these.
  - Related org repos (stars, live): `opral/inlang` (core TMS/format repo) 1,967 stars, 175 forks, created 2021-08-10; `opral/lix` (version control) 715 stars; `opral/sherlock` (VS Code ext) 15 stars; `opral/parrot-figcd` 44 stars (archived); `opral/ninja-i18n-action` 7 stars (archived); `opral/flashtype` 268 stars (new, unrelated-to-i18n AI markdown editor).
  - inlang.com claims "110+ contributors" ecosystem-wide — not independently verified.
- First release / age: first npm publish `1.0.0-prerelease.0` on 2023-10-16 (npm `created` timestamp matches). Paraglide JS is ~2 years 9 months old as of 2026-07-06. Dedicated `opral/paraglide-js` GitHub repo created 2024-03-11 (split out of a monorepo later than the npm package's first release). The broader inlang ecosystem (`opral/inlang` repo) dates to 2021-08-10, i.e. ~5 years old.

## Positioning & target audience

- Paraglide JS markets itself as a "compiler-based i18n library that emits tree-shakable translations, leading to up to 70% smaller bundle sizes" (GitHub repo description).
- inlang.com positions the broader ecosystem as an "open-format TMS (translation management system)": the `.inlang` project file is the source of truth, and developers, translators, CI, editors, and "AI agents" all read/write the same format rather than a proprietary database.
- Target audience: JS/TS teams (any framework) wanting compile-time, tree-shakable i18n, plus larger orgs/localization teams wanting a git-based, tool-agnostic translation workflow.
- Marketing site lists adopter logos: Kraft Heinz, Bose, Disney, ETH Zurich, Brave, Michelin, Idealista, Architonic, Lovable, Klaviyo (self-reported, unverified).
- inlang.com explicitly frames "AI agents" as a stakeholder class that should read/update `.inlang` projects via the SDK "rather than inventing custom schemas."

## Core concepts & architecture

- Compile-time approach: translation messages are compiled at build time into plain **typed ESM/JS functions**, one per message (e.g. `m.hello_world()`), imported like normal code — not resolved via a runtime library/parser.
- Explicit claim: "No runtime overhead. No framework lock-in."
- Tree-shaking: because each message is its own exported function, bundlers (Vite/Rollup, and per the 2.20.0 changelog, Rolldown) can drop unused messages entirely. As of 2.20.0, the compiler also emits a `messages/package.json` marking generated modules side-effect-free to help bundlers per-page code-split more aggressively.
- Bundle-size claim: "up to 70% smaller bundles" than runtime i18n libraries; concrete example cited: **47 KB (Paraglide) vs. 205 KB (i18next)** for 5 locales / 200 messages, 100 actually used. Bundle size claimed to scale with messages _used_, not total catalog size (100 used messages ship the same ~47 KB whether the catalog has 200, 500, or 1,000 total messages).
- Caveat found in GitHub issues: tree-shaking is easy to defeat in practice — a maintainer commented on issue #287 that re-exporting messages from a shared `i18n.js` file causes all messages to load, undermining the "automatic" claim in some common usage patterns. Issue #88 ("per locale splitting builds," 55 comments, open) and #354 ("server side pre-rendered messages shouldn't get shipped to the client," open) indicate the tree-shaking/code-splitting story has known unresolved gaps.
- Message format: default is inlang's native project format (`.inlang` file or unpacked `.inlang/` directory, JSON-based, git-friendly in both packed and unpacked forms). Plugin support for **JSON**, **i18next** files, **XLIFF**, and **ICU MessageFormat 1**.
- Type safety: message functions are generated with full TS support — autocomplete on keys/params, typos become compile errors, no manual type-declaration merging needed (contrasted with react-i18next's manual type augmentation, per an independent comparison article).
- SSR handling: server-side locale resolution uses `AsyncLocalStorage` so `getLocale()`/message functions resolve correctly per-request under concurrency (per docs/changelog synthesis).
- Version 2.0 (a major rewrite) removed the need for framework-specific adapter packages in favor of one framework-agnostic Vite plugin; added variants/pluralization support, nested message keys, flexible locale strategies (URL/cookie/domain/session), and multi-tenancy. Breaking changes included renaming `LanguageTag`/`languageTag` APIs to `locale`, renaming `runtime.locales` to `runtime.availableLocales`, removing `@inlang/paraglide-*` adapter packages, and requiring a **full page reload on locale change** (`localizeHref()` replaces prior path-localization approach) — i.e., no live/reactive locale switching without reload, by design.

## Framework & platform support

- Documented adapters/integrations: React (with Vite or Router), Next.js (dedicated adapter + docs page), SvelteKit (official integration built on Paraglide), TanStack Start, TanStack Router (e2e-tested examples), React Router, Astro, Vue, Solid, vanilla JS/TS, and a generic framework-agnostic Vite plugin.
- Known friction points from GitHub issues: Next.js/SvelteKit SSR edge cases (issue #245, "nextjs 15 'await headers' warning," 30 comments, still open as of research; issue #424, "Can't build v2 beta on Cloudflare Pages," 31 comments; issue #461, "getLocale returns the wrong value on the Sveltekit server," 23 comments); routing is described in issue #70 as "very opinionated," lacking APIs for non-default routing logic such as domain-based routing at the time of that issue.
- Issue #449 ("Middleware Paraglide for React Router v7," 38 comments) and #512 ("Removing baseLocale from url," 19 comments) suggest routing/middleware integration required significant iteration per-framework despite the "framework-agnostic" positioning.

## Catalog formats & interop

- Native format: `.inlang` project (packed file or unpacked directory), JSON-based, designed to be git-diffable.
- Plugin-based import/export: JSON, i18next, XLIFF, ICU MessageFormat 1. No first-class .po/gettext plugin was found in the fetched docs (not verified as absent — only not found in the sources checked).
- Ecosystem editors that read/write the same `.inlang` format without touching code:
  - **Sherlock** — VS Code extension, inline decorations/hover for translations, "extract new strings with a single click." Marketplace: 49,055 installs, 5/5 rating (15 reviews). Small GitHub footprint (15 stars, 6 open issues) relative to install count — suggests the code lives mostly outside typical open-source engagement patterns (or issues are filed elsewhere).
  - **Fink** — web-based CAT (computer-assisted translation) editor at fink.inlang.com, aimed at translators who don't want to work in Git directly. The `opral/inlang-fink` GitHub repo is only an issue tracker (1 star, 11 open issues); actual app code location unclear from research.
  - **inlang SDK** (`@inlang/sdk`) — read/write reference API for `.inlang` projects, used by editors, CLIs, runtimes, CI, and (per inlang.com messaging) AI coding agents.

## Workflow & tooling

- CLI supports linting for missing translations and (per inlang.com) machine translation as part of CI/CD.
- Git-native workflow: `.inlang` is designed to be committed and diffed like source code; Lix (a separate Opral product, 715 GitHub stars) provides a general version-control/change-review layer ("history, review, change proposals, rollback, merging") that can sit under `.inlang` projects.
- Two ecosystem tools are now discontinued/dormant, evidencing product churn:
  - **Ninja** (GitHub Action for i18n linting in PRs) — repo `opral/ninja-i18n-action` is archived; inlang's own docs page states Ninja "has been deprecated" and advises against using it for new projects.
  - **Parrot** (originally a Figma plugin linking design text to `.inlang`) — publisher repo `opral/parrot-figcd` is archived; a near-empty successor repo `opral/parrot` (2 stars) shows minimal activity, indicating the tool is effectively dormant.
- Broader product-line signal: Opral's site (opral.com) now frames the company around three products — **Flashtype** (a Markdown editor "for Claude & Codex," 268 GitHub stars, built on Lix), **Lix** (general file-format version control), and **Inlang** (the open-format TMS). This shows the center of gravity shifting from "i18n tooling" toward general "file-based workflow infrastructure" for AI agents, with Paraglide/inlang now one product line among several rather than the sole focus. No explicit company statement/retrospective confirming this as an intentional "pivot" was found; this is inferred from repo activity, archival status, and current site framing.

## AI features

- inlang.com references machine translation as part of CI/CD workflows (exact implementation/vendor not confirmed from fetched sources).
- Fink is described in secondary sources (WebSearch synthesis, not a directly confirmed primary-source fetch) as supporting AI auto-translation with confidence scores, translation memory, glossary, and versioning — flag as low-confidence, unconfirmed by direct page fetch.
- No product literally named "Paraglide AI" exists.
- Flashtype (separate product, not i18n-specific) is explicitly built for AI coding agents (Claude/Codex) to edit Markdown/files via Lix's version-control substrate — signals Opral's broader AI-agent tooling ambitions beyond translation.
- inlang.com messaging explicitly invites "AI agents" to read/write `.inlang` projects via the SDK "rather than inventing custom schemas."

## Pricing

- No pricing page or paid-tier information found on opral.com or inlang.com.
- All identified products (paraglide-js, inlang, lix, sherlock, flashtype) are MIT-licensed with no visible hosted paid offering found in the pages fetched.
- Opral is reported as unfunded (per Tracxn, not independently confirmed) with ~7 employees — consistent with either a pre-monetization stage or a monetization model not surfaced in the pages checked (e.g., a possible future hosted/enterprise Fink tier is speculative, not evidenced).

## Strengths

- Genuinely compile-time architecture: no runtime i18n library shipped to the client; message functions are plain tree-shakable ESM.
- Concrete, sourced bundle-size advantage in typical scenarios (47 KB vs. 205 KB example) — independent blog posts corroborate large reductions (one author reports ~40 KB to ~2 KB after switching from i18next).
- Strong generated TypeScript DX: autocomplete and compile-time errors for message keys/params without manual type-declaration work.
- Broad framework coverage (React, Next.js, SvelteKit, TanStack Start/Router, React Router, Astro, Vue, Solid, vanilla) via one framework-agnostic Vite plugin as of v2.
- Ecosystem tooling around a shared, git-friendly `.inlang` format: VS Code extension (Sherlock, ~49k installs, 5/5 rating), a non-technical translator web editor (Fink), and an SDK for CI/automation/AI agents.
- High and apparently growing adoption: ~358K npm weekly downloads, active weekly-to-biweekly release cadence.

## Weaknesses & criticism

- Locale switching requires a full page reload by design (v2 architecture) — no built-in reactive/live locale switching.
- Significant, well-documented v1→v2 migration pain: renamed core APIs (`languageTag`→`locale`, `runtime.locales`→`runtime.availableLocales`), removed framework-specific adapter packages (breaking e.g. SvelteKit's `<ParaglideJS>` component, requiring manual reimplementation). GitHub issue #201 ("Paraglide JS 2.0" tracking issue) drew 70 comments; issue #335 (a migration error) drew 24 comments.
- Routing/SSR friction recurs across frameworks despite "framework-agnostic" positioning: Next.js `await headers()` warnings (issue #245, 30 comments, open), Cloudflare Pages build failures on v2 beta (issue #424, 31 comments), SvelteKit server-side locale bugs (issue #461, 23 comments), and early complaints that routing was "very opinionated" with no API for non-default (e.g. domain-based) routing (issue #70).
- Tree-shaking/bundle-size promise has known gaps: a maintainer confirmed that common patterns like re-exporting messages from a shared file defeat tree-shaking (issue #287); per-locale build splitting remains an open, 55-comment feature request (issue #88) years into the project.
- TypeScript type generation can lag behind rapid message additions, per an independent (otherwise positive) review.
- Ecosystem churn / discontinued tools: Ninja (GitHub Action) is explicitly deprecated; Parrot (Figma plugin) is archived/dormant — both signal that peripheral inlang-ecosystem tools have a track record of being abandoned.
- Company/product focus has broadened beyond i18n (Lix general version control, Flashtype AI markdown editor), which could be read either as healthy platform expansion or as reduced dedicated focus on the i18n product line — no confirmation either way from a primary source.
- No Reddit-specific discussion threads were found despite targeted searches; independent commentary is concentrated in GitHub issues and a handful of individual developer blog posts rather than broader community forums.
- No visible monetization/pricing model found — long-term maintenance funding for a ~7-person, apparently-unfunded company is not evidenced.

## What they do differently

- True compile-time codegen model: messages become individually tree-shakable ESM functions rather than being resolved by any runtime library — this is a stronger "zero runtime" claim than most competitors, including hybrid/compiled tools that still ship a thin runtime.
- Deliberately reload-based locale switching (no reactive live-switch) baked into the v2 architecture as an explicit design trade-off, not an oversight.
- The `.inlang` project format is positioned as a shared, vendor-neutral substrate meant to be read/written not just by the compiler but by a whole constellation of independent tools (VS Code extension, web CAT editor, CI linter, Figma plugin, AI agents) — an ecosystem/platform bet rather than a single-library bet.
- Company (Opral) is generalizing the underlying tech (Lix version control) into non-i18n products (Flashtype, an AI-agent markdown editor), suggesting the git-based/version-controlled-file paradigm is being treated as reusable infrastructure beyond localization.
- Aggressive breaking-change posture across major versions (adapter packages removed, core APIs renamed) in exchange for architectural simplification — a deliberate willingness to break backward compatibility for a cleaner long-term abstraction, evidenced by the extensive, well-documented v1→v2 migration guides and community migration blog posts.
- Several early ecosystem tools (Ninja, Parrot) were shipped, then explicitly deprecated or left dormant — a visible pattern of iterating in public and cutting things that didn't stick, rather than maintaining a fixed tool lineup.

## Sources

- https://inlang.com (accessed 2026-07-06)
- https://paraglidejs.com/ (accessed 2026-07-06)
- https://paraglidejs.com/comparison (accessed 2026-07-06)
- https://paraglidejs.com/changelog (accessed 2026-07-06)
- https://paraglidejs.com/server (referenced, accessed 2026-07-06)
- https://paraglidejs.com/next-js (referenced, accessed 2026-07-06)
- https://github.com/opral/paraglide-js (accessed 2026-07-06)
- https://github.com/opral/paraglide-js/blob/main/docs/architecture.md (accessed 2026-07-06)
- https://github.com/opral/paraglide-js/blob/main/docs/compiling-messages.md (accessed 2026-07-06)
- https://github.com/opral/paraglide-js/blob/main/CHANGELOG.md (accessed 2026-07-06)
- https://github.com/opral/paraglide-js/issues (issues #70, #88, #201, #238, #245, #273, #287, #321, #335, #354, #407, #423, #424, #440, #449, #461, #486, #512 — accessed 2026-07-06)
- https://api.github.com/repos/opral/paraglide-js (live API, accessed 2026-07-06)
- https://api.github.com/orgs/opral/repos (live API, accessed 2026-07-06)
- https://registry.npmjs.org/@inlang/paraglide-js (live API, accessed 2026-07-06)
- https://registry.npmjs.org/@inlang/paraglide-js/latest (live API, accessed 2026-07-06)
- https://api.npmjs.org/downloads/point/last-week/@inlang/paraglide-js (live API, accessed 2026-07-06)
- https://www.npmjs.com/package/@inlang/paraglide-js (accessed 2026-07-06)
- https://marketplace.visualstudio.com/items?itemName=inlang.vs-code-extension (Sherlock, accessed 2026-07-06)
- https://fink.inlang.com/ (accessed 2026-07-06)
- https://inlang.com/m/tdozzpar/app-inlang-finkLocalizationEditor (referenced, accessed 2026-07-06)
- https://opral.com (accessed 2026-07-06)
- https://tracxn.com/d/companies/opral (aggregator, low-confidence, accessed 2026-07-06)
- https://theorg.com/org/opral-inlang-lix (aggregator, low-confidence, accessed 2026-07-06)
- https://f4.fund/startups/opral (aggregator, low-confidence, accessed 2026-07-06)
- https://dropanote.de/en/blog/20250506-paraglide-migration-2-0-sveltekit/ (independent blog, accessed 2026-07-06)
- https://dropanote.de/en/blog/20250726-why-i-replaced-i18next-with-paraglide-js/ (independent blog, accessed 2026-07-06)
- https://dev.to/cordlesswool/paraglide-20-migration-from-framework-glue-to-clean-abstraction-4d1b (accessed 2026-07-06)
- https://dev.to/erayg/best-i18n-libraries-for-nextjs-react-react-native-in-2026-honest-comparison-3m8f (accessed 2026-07-06)
- https://intlayer.org/en-GB/doc/benchmark/nextjs (competing-vendor comparison, accessed 2026-07-06)
- https://brodin.dev/blog/paraglide-vs-react-i18n (independent blog, accessed 2026-07-06)
