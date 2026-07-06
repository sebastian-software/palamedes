---
title: General Translation
category: hybrid
analyzed: 2026-07-06
analyzed_versions: "gt-next 11.0.0, gt-react 11.0.0, generaltranslation (core) 9.0.0, @generaltranslation/compiler 1.3.25, @generaltranslation/react-core 11.0.0, gt-i18n 1.0.0, SaaS platform state as of 2026-07-06"
homepage: https://generaltranslation.com
repository: https://github.com/generaltranslation/gt
---

# General Translation

## Snapshot

- Maintainer / company / funding: General Translation, Inc. (San Francisco). Founder/CEO: Archie McKenzie (Princeton CS '24; ex-TA for Brian Kernighan). Team described in third-party coverage as "ex-Sentry, Meta, Goldman Sachs" engineers; exact headcount not verified. Seed round of $2.74M (Crunchbase/Fundz.net) or $2.39M (SignalBase) closed 2024-11-14 — sources disagree on exact amount, treat as ~$2.4-2.7M seed, not fully verified. No confirmed Y Combinator affiliation found (searched explicitly; no YC company-page match).
- License / business model: SDKs (gt-next, gt-react, gt-i18n, core `generaltranslation` package) are published under **FSL-1.1-ALv2** (Functional Source License), not a standard OSI open-source license. FSL restricts "Competing Use" for 2 years from each version's release, after which that version relaxes to Apache-2.0. GitHub shows license as "Other / NOASSERTION" (confirms non-standard license, not MIT/Apache at repo level). The platform/CDN/translation backend is closed-source SaaS. Business model: freemium usage-based SaaS (Starter = free platform fee + usage-based translation rates; Enterprise = custom quote).
- Current stable version + release date: gt-next 11.0.0 and gt-react 11.0.0, published 2026-07-04 (per npm registry `time` field). Package has had 543 published versions total since first publish 2024-09-13 — indicates very high release velocity (frequent, likely automated/patch-heavy releases).
- Adoption: gt-next 20,213 weekly downloads, gt-react 29,728 weekly downloads (both npm, week of 2026-06-29–2026-07-05). GitHub repo generaltranslation/gt: 964 stars, 29 forks, 80 open issues, TypeScript 93.6%, created 2024-11-19, last push 2026-07-04 (actively maintained). Named customers per docs/marketing: Cursor, Cognition, ClickHouse, Ramp, Profound, Partiful, Mintlify, T3Chat (Theo).
- Founded / age: company founded ~2023-2024 (GitHub org created 2024-11-19; seed round Nov 2024); roughly 2 years old as of analysis date — a young/early-stage company relative to established i18n tooling.

## Positioning & target audience

- Positions as "an entire localization and internationalization (i18n) stack, built to ship multilingual apps from end-to-end" — a full-stack, AI-first alternative to assembling i18n library + TMS + MT provider separately.
- Targets developers directly (not localization managers): React/Next.js/React Native application engineers who want to add multi-language support without building translation-key dictionaries or managing a separate TMS.
- Heavy emphasis on "ship in 120 languages" / "100+ languages" and speed-to-market messaging aimed at startups and AI-native product teams.
- Competes both with developer-first i18n libraries (react-intl, next-intl, i18next) and with hosted TMS platforms (Crowdin, Lokalise) by bundling both roles into one product plus an AI coding agent (Locadex) for automating the i18n refactor itself.
- Positions Locadex (AI agent that rewrites code to wrap translatable content and opens PRs) as a differentiator against tools that only handle the runtime/translation layer, not the initial code migration.

## Core concepts & architecture

- Core primitive is the `<T>` JSX component: "You can wrap as much or as little JSX as you want inside `<T>`. Everything inside it — text, nested elements, even formatting — gets translated as a unit." No manual extraction into a flat key/string dictionary is required for JSX content.
- For non-JSX strings (attributes like `aria-label`, `alt`, `placeholder`), a `useGT()` hook provides a callable translation function, e.g. `gt('Enter your email')` — a secondary, string-based API alongside the component-based one.
- Build pipeline: a compiler (`@generaltranslation/compiler`) statically parses `<T>` usage at build/CLI time to extract translatable content; translations are generated via CLI (`npx gt@latest` / `gtx-cli translate`) and bundled/published ahead of deploy — translation generation is a build-time step wired into `npm run build` (e.g. `"build": "npm run translate && <build command>"`).
- Dev-mode behavior differs from production: in development, `<T>` calls a live API backed by a small AI model to produce temporary, non-persisted translations for instant preview; in production, no live API/model calls happen (avoids leaking API keys) — pre-generated translations are loaded instead, either from General Translation's CDN or a custom `loadTranslations` source.
- Message identity/hashing scheme is not documented in any fetched page — not verified how content-level hashing or diffing (equivalent to msgid stability) is implemented internally.
- ICU message format support not explicitly documented in fetched pages — not verified.
- Type safety: no TypeScript-specific type-safety guarantees (e.g., compile-time key checking) were found documented in the fetched pages — not verified as a distinguishing feature the way it might be for pure-dictionary-based libraries.
- Ecosystem packages: `gt-react` (React runtime), `gt-next` (Next.js runtime, wraps gt-react + adds SSR/middleware/routing), `gt-i18n` (shared/pure-JS core), `generaltranslation` (core API client), `@generaltranslation/compiler` (static JSX extraction), `@generaltranslation/react-core`, `@generaltranslation/format`, `@generaltranslation/supported-locales`.

## Framework & platform support

- Confirmed supported: React, Next.js (13.0.0–15.2.1, excluding 15.2.2, per gt-next package metadata; React ≥16.8.0 / ≥18.0.0 depending on package), React Native, TanStack Start, Node.js (backend), Python (backend/API use), plus CMS/docs integrations (Mintlify, Sanity Studio plugin).
- No evidence found of SolidStart, Waku, Vite-generic (non-React), React Router (as a standalone framework, distinct from Next.js/TanStack), Vue, or Svelte support — the SDK ecosystem is React-centric (React + its meta-frameworks) plus limited backend language bindings (Node, Python). This is a materially narrower framework matrix than Palamedes' stated one-runtime-model-across-Next.js/TanStack Start/SolidStart/Waku/React Router/Vite/backend-servers scope.
- gt-next's own compatibility table already shows framework-version pinning/exclusions (e.g., explicit exclusion of Next.js 15.2.2), suggesting tighter coupling to specific framework internals than a framework-agnostic runtime.

## Catalog formats & interop

- No standard catalog format (e.g., .po/gettext, ICU MessageFormat JSON) confirmed as the primary interchange format from fetched docs; the system is built around JSX-as-source-of-truth plus a proprietary translation storage/CDN model rather than flat key-value or PO catalogs.
- Self-hosting/export path exists: docs and FAQ confirm "General Translation internationalization libraries are free, open-source, and can be configured to fetch translations from any source" — a `loadTranslations` config function lets teams load translations from their own bundle/CDN instead of General Translation's hosted CDN, and automatic CDN publishing can be disabled.
- Despite the "open-source libraries" framing, the actual SDK license (FSL-1.1-ALv2) is source-available with a time-delayed conversion to Apache-2.0, not an OSI-approved open-source license from day one of each release — a nuance the marketing/FAQ language elides.
- No dedicated interop/export tooling (e.g., conversion to .po, XLIFF) was found documented — catalog portability outside the GT ecosystem is not verified.

## Workflow & tooling

- CLI: `gt` / `gtx-cli` — `npx gt@latest` bootstraps a project (setup wizard); `gtx-cli translate` generates and downloads translations (build-time step); `gtx-cli stage` stages translations for human review in CI/CD (analogous to "git add + git commit" for translations, per docs) instead of finalizing immediately.
- GitHub integration: PR-based workflow for reviewing/merging translation changes, plus Locadex opening its own PRs for code i18n-ification.
- Translation Editor: hosted side-by-side source/translation review UI in the web platform.
- Translation CDN: global edge delivery (marketing claims 300+ edge nodes) with over-the-air updates and "version branching" for translations.
- Dev-mode "live translation": on-the-fly AI translation during local development for instant preview without persisting or publishing.
- Human review: gated to paid plans — a "Human Review" toggle in project settings routes AI translations through human proofreading before publish.
- Glossary: glossary terms/instructions organized into shareable "context groups" across projects; an "Apply glossary" action can retroactively update existing translations containing glossary terms.

## AI features

- Core value proposition is AI-driven translation "in context" using unspecified underlying LLM(s) — no fetched source names specific model providers/versions (e.g., GPT-4/5, Claude, Gemini) powering production translation; not verified.
- Locadex: an AI coding agent (separate from the translation model) that scans a codebase, wraps untranslated content in `<T>`/`useGT`, and opens pull requests — automates the initial i18n refactor rather than just ongoing translation.
- Dev-mode translations use "a small AI model" (docs' own wording) for fast, disposable previews, distinct from the production translation pipeline.
- Human-in-the-loop option (paid plans only) for reviewing/approving AI output before it ships.
- Glossary/context-group system feeds terminology constraints into AI translation and can be re-applied to existing translations.

## Pricing

- Starter: $0 platform fee, for individuals/small teams; unlimited users/projects/languages; usage-based rates apply per translation volume (exact per-word/token rates not published in fetched pages — not verified).
- Enterprise: custom quote; adds SLAs, dedicated forward-deployed engineers, SSO (SAML/OIDC), priority support (Slack/phone/email), SOC 2 Type II / ISO 27001-backed enterprise security assurances.
- Both tiers include: Translation Editor, GitHub integration, Locadex AI agent, translation CLI, "open-source" SDKs, translation CDN, version branching.
- No free-tier volume cap was stated in fetched pricing content; billing is usage-based on top of a free platform layer rather than a hard free-tier limit — exact metering unit (per word, per character, per API call) not verified.

## Strengths

- Very low integration friction for React/Next.js codebases: wrapping existing JSX in `<T>` avoids the upfront work of extracting strings into a key-based dictionary, which is usually the biggest adoption cost for i18n libraries.
- Locadex differentiates from pure runtime/SDK competitors by automating the code-migration step itself (PR-generating agent), not just runtime translation delivery.
- Single vendor covers the full pipeline (extraction → AI translation → human review → CDN delivery), reducing the need to stitch together a library + separate TMS + MT provider.
- High release velocity (543 published versions since Sept 2024) and active maintenance (last GitHub push 2026-07-04, org created late 2024) suggest a fast-moving, well-resourced team for its age.
- Notable technically-credible customer list (Cursor, Cognition, ClickHouse, Mintlify) lends adoption signal in the developer-tools segment specifically.
- Self-hosting escape hatch (`loadTranslations`, disable CDN publishing) avoids full lock-in to GT's CDN even though the default path routes through it.

## Weaknesses & criticism

- License ambiguity: FAQ/marketing calls the SDKs "free, open-source," but the actual license (FSL-1.1-ALv2) is source-available with a 2-year delayed Apache-2.0 conversion and a "Competing Use" restriction — this is a materially different legal position than MIT/Apache-licensed i18n libraries (e.g., react-intl, i18next), and the "open-source" framing in official docs is not strictly accurate by OSI standards. No independent commentary specifically calling this out was found in this pass — flagging as an analyst observation, not sourced criticism.
- Framework coverage is narrow relative to Palamedes' target matrix: no SolidStart, Waku, Vue, Svelte, or generic Vite support found; React ecosystem only (React, Next.js, React Native, TanStack Start) plus Node/Python backends.
- Underlying translation model(s) are undisclosed in public docs (not verified which LLM(s) power production translation) — makes independent quality/consistency evaluation difficult versus competitors who name their MT/LLM engine choices.
- Human review is paywalled (paid plans only) — teams on the free Starter tier get AI-only output with no built-in human QA step, a quality risk for production-facing copy.
- No independent third-party reviews, critical blog posts, Hacker News/Reddit threads, or comparison articles specifically about General Translation/gt-next were found via web search in this pass — the product has limited independent public scrutiny to date (consistent with its ~2-year age and moderate GitHub star count of 964); assess as an early-stage, low-external-scrutiny product rather than one with a track record of resolved public criticism.
- Version/dependency coupling: gt-next explicitly excludes a specific Next.js patch version (15.2.2) in its peer-dependency range, indicating some fragility/tight coupling to framework internals rather than a stable, framework-version-agnostic runtime boundary.
- Funding figures are inconsistently reported across sources ($2.74M vs $2.39M seed) — exact capitalization not independently verified from a primary source (e.g., SEC Form D) in this pass.

## What they do differently

- JSX-block-as-translation-unit (`<T>` wrapping arbitrary nested JSX) instead of a flat key/string dictionary — removes the manual string-extraction step that most i18n libraries (including PO/ICU-catalog-based ones) require as a first step.
- Ships an AI coding agent (Locadex) that performs the initial i18n code migration itself and opens PRs, rather than only providing a runtime/library for translations that a human must first wire up by hand.
- Default production model has zero live translation/API calls in production — translations are fully pre-generated at build time and served from a CDN or bundle, while development mode uses live, disposable, non-persisted AI translations purely for fast local preview (an explicit dev/prod behavioral split baked into the SDK, rather than a single runtime behavior across environments).
- Bundles library + AI translation engine + hosted TMS-style review UI + CDN delivery into one vertically integrated vendor/product, rather than positioning as a neutral runtime library that's MT/TMS-agnostic.
- Uses a source-available license (FSL-1.1-ALv2) with a time-delayed open-source conversion for its client SDKs — a licensing model borrowed from Sentry's playbook, unusual among JS i18n runtime libraries, most of which (react-intl, i18next, next-intl) are permissively MIT/BSD licensed from the outset.
- "Stage" workflow (`gtx-cli stage`) explicitly modeled as a git-like intermediate commit step for translations, folding a review checkpoint into the CLI itself rather than leaving review entirely to an external TMS UI.

## Sources

- https://generaltranslation.com/en-US/home — accessed 2026-07-06
- https://generaltranslation.com/en-US/docs/overview — accessed 2026-07-06
- https://generaltranslation.com/en-US/docs/react — accessed 2026-07-06
- https://generaltranslation.com/en-US/docs/overview/faqs — accessed 2026-07-06
- https://generaltranslation.com/en-US/pricing — accessed 2026-07-06
- https://registry.npmjs.org/gt-next/latest and https://registry.npmjs.org/gt-next (full version history) — accessed 2026-07-06
- https://registry.npmjs.org/gt-react/latest — accessed 2026-07-06
- https://api.npmjs.org/downloads/point/last-week/gt-next — accessed 2026-07-06
- https://api.npmjs.org/downloads/point/last-week/gt-react — accessed 2026-07-06
- https://github.com/generaltranslation/gt (via GitHub REST API, repos/generaltranslation/gt) — accessed 2026-07-06
- https://www.crunchbase.com/organization/general-translation (indexed via search; direct fetch returned 403) — accessed 2026-07-06
- https://app.fundz.net/fundings/general-translation-funding-round-6d3696 (seed funding amount, via search) — accessed 2026-07-06
- https://www.trysignalbase.com/news/funding/general-translation-secures-2.39m-in-seed-round-funding-for-innovative-language-and-localization-tools — accessed 2026-07-06
- https://councils.forbes.com/profile/Archie-McKenzie-CEO-General-Translation-Inc/ (founder background, via search) — accessed 2026-07-06
- https://spdx.org/licenses/FSL-1.1-ALv2.html and https://fsl.software/ (license terms, via search) — accessed 2026-07-06
- General web searches for independent commentary/criticism ("General Translation" / gt-next reviews, Reddit, Hacker News) — no substantive independent commentary found as of 2026-07-06
