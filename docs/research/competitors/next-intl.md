---
title: next-intl
category: frontend-framework
analyzed: 2026-07-06
analyzed_versions: "next-intl@4.13.1 (Jul 6, 2026 npm registry); use-intl@ (same monorepo release train, weekly downloads checked separately)"
homepage: https://next-intl.dev
repository: https://github.com/amannn/next-intl
---

# next-intl

## Snapshot
- Maintainer / company / funding: Single primary maintainer, Jan Amann (@amannn), independent OSS developer. Funded via GitHub Sponsors — 8 active monthly sponsors as of 2026-07-06 (goal: 15), tiers $10–$500/month; sponsors include Crowdin and i18nexus (both localization vendors), plus ~30 past sponsors. No corporate backing or foundation; not part of Vercel despite deep Next.js integration.
- License: MIT
- Current stable version + release date: v4.13.1, released 2026-06-30 (per npm registry `dist-tags.latest` and GitHub Releases). Prior notable releases: v4.13.0 (2026-05-28, URL-safe base64 keys for `useExtracted`), v4.12.0 (2026-05-13), v4.11.x (Apr–May 2026).
- Adoption: npm weekly downloads for `next-intl` ≈ 4,027,357 (week of 2026-06-29–07-05, api.npmjs.org); `use-intl` weekly downloads ≈ 4,042,864 (same week) — the two track almost identically since next-intl depends on use-intl. GitHub: 4,311 stars, 361 forks, 52 open issues (github.com/amannn/next-intl, live API pull 2026-07-06). 90 GitHub releases total. Named users on homepage: Node.js, Todoist, Uber, Ethereum, Solana (unverified beyond homepage claim).
- First release / age: Repository created 2020-11-20 — roughly 5.7 years old as of analysis date.

## Positioning & target audience
- Positioned strictly as "Internationalization (i18n) for Next.js" — not a general React or JS i18n library (that role is delegated to the sibling `use-intl` package).
- Tagline: "Support multiple languages, with your app code becoming simpler instead of complex"; "Batteries included, minimalistic API."
- Targets Next.js App Router / Server Components users specifically; positions itself as the default/idiomatic choice for teams already committed to Next.js.
- Documented design principles (from `/docs/design-principles`): holistic (dates, plurals, RTL, SEO, routing — not just string lookup), ergonomic, standards-based (ECMA-402 + ICU), compatible with external TMS/CMS, performance-obsessed for RSC, Next.js-first but migration-friendly (via use-intl and ICU as an escape hatch).

## Core concepts & architecture
- **Message identity — two coexisting models as of 2026:**
  - Traditional/stable: explicit hand-written keys in nested JSON (`"HomePage.title"`), accessed via `t('title')` inside `useTranslations('HomePage')`. This remains the primary, non-experimental workflow.
  - New/experimental (`useExtracted`, shipped as experimental starting v4.5, current in 4.13): source-string-first API — developers call `t('Hello world!')` directly with the literal string as the argument; a build-time Turbopack/Webpack loader statically extracts these into a message catalog with **auto-generated short keys** (e.g. `VgH3tb` in JSON, `5VpL9Z`/`Ju9oB+`-style ids in PO), then compiles the call back to a normal key lookup. This is a direct architectural convergence toward the source-string/PO model that Palamedes uses natively — but bolted onto next-intl as an opt-in compiler pass rather than being the native runtime model.
- ICU MessageFormat is used throughout for interpolation, plural, selectordinal, and select; both the stable and experimental APIs share this format.
- Routing: dedicated middleware negotiates locale and handles redirect/rewrite (`/` → `/en`); "Navigation APIs" wrap Next.js's `Link`/`useRouter`/`redirect` so app code uses standard APIs while locale prefixing and localized pathnames (e.g. `/de/über-uns`) are handled transparently. Supports prefix-based and domain-based routing strategies; a "no routing" mode exists for apps that don't need locale-in-URL.
- RSC/Server Components model is central to the architecture: messages are resolved server-side via `getTranslations()` (async, for Server Components/Server Actions) or `useTranslations()` (works in both Server and Client shared components via react-server conditional exports). Explicit philosophy: "messages never leave the server" unless a Client Component needs them, in which case developers either pass pre-translated strings as props or selectively hydrate messages via `NextIntlClientProvider`.
- Type safety: `Messages` interface augmentation (import your `en.json`, assign to `AppConfig`) gives autocomplete and compile-time checking of valid namespace/key paths; an additional `.d.json.ts` mechanism can type-check ICU arguments (e.g. catches a missing `{firstName}`), adding ~0.6s compile time on a 340+ message project (per docs).
- Extraction story: previously none (pure key-based, like i18next) — now has a first-party but experimental extraction pipeline (`useExtracted`/`getExtracted`) with real constraints from static analysis: `t` must receive a literal string, must be called in the same function body it was retrieved in, cannot be passed to other functions or re-exported, no dynamic/runtime message selection.

## Framework & platform support
- Next.js-only for the `next-intl` package itself (App Router and Pages Router both supported; peer dep range Next ^12–^16, React ^16.8–^19 per package.json).
- `use-intl` is the framework-agnostic core (translator/formatter primitives, `createTranslator`/`createFormatter` usable in any JS runtime) and is the supported path for plain React, React Native, Jest, and Storybook. No official adapters found for TanStack Start, SolidStart, Waku, React Router (framework mode), or Vite-based SPAs beyond generic React usage of `use-intl`. Vite/other-meta-framework users are expected to hand-roll integration on top of `use-intl`.
- A third-party project (cloudflare/vinext) reports incompatibility trying to combine next-intl with its own routing model — confirms the library is tightly coupled to Next.js's specific routing/middleware internals rather than portable across meta-frameworks.

## Catalog formats & interop
- Primary format: JSON, one file per locale, hierarchical namespaces via dot notation.
- PO format is now also supported specifically for the `useExtracted` experimental workflow, explicitly recommended over JSON there because PO supports file-reference comments and translator-facing descriptions ("context... helpful for (AI) translators" per the announcement blog post). Not clear whether PO is available for the traditional key-based workflow or only the extraction pipeline.
- TMS integration: no proprietary platform; documented first-class integration is Crowdin (Crowdin is also a GitHub Sponsor of the project — commercial alignment). Crowdin integration works via file-based sync (`/messages/en.json` ↔ `/messages/%locale%.json`) plus Crowdin's GitHub Action for auto-PRs, in-context translation, machine-translation suggestions, and glossaries. Docs state it "works with all localization management platforms that support translating JSON files" — i.e., generic JSON/PO interop rather than a deep proprietary pipeline.

## Workflow & tooling
- `createNextIntlPlugin` wraps `next.config.ts`; `i18n/request.ts` provides request-scoped config (locale + messages) via `getRequestConfig`.
- Extraction (experimental) integrates automatically into `next dev`/`next build` — no separate CLI extraction step required once enabled; falls back gracefully to using the inline literal directly when there's no Next.js build step (e.g., in unit tests).
- Manual/library extraction path (`unstable_extractMessages`) exists for monorepo packages/component libraries that don't run their own Next dev server; consuming apps merge multiple `messages.path` sources and must add the package to `transpilePackages`.
- Reported rough edges in extraction tooling (from GitHub Discussion #2036): non-deterministic `.po` file ordering across builds (causes noisy git diffs), no fallback-to-source-locale for untranslated strings (renders empty instead), and `msgid` in PO output holding a random generated key rather than the literal source string (this is the opposite of standard gettext convention, where `msgid` normally *is* the source string) — this was raised explicitly by the community as counter to how other PO-based tools work.

## AI features
- No AI translation, AI QA, or AI-authoring product features in next-intl itself.
- The `useExtracted`/PO-based design is explicitly motivated by improving downstream AI *translation* workflows (richer context — descriptions, file refs — for AI-driven TMS translation) and by reducing context-window/cognitive burden on AI coding agents that generate UI code (avoids requiring the agent to invent/maintain key names). This is a tooling/workflow rationale, not a built-in AI feature.

## Pricing
- Free and open source (MIT). No paid tier, no hosted product, no next-intl-branded SaaS.
- Revenue model is maintainer-level GitHub Sponsors only (8 sponsors, ~$10–$500/mo tiers, goal of 15 sponsors — small scale). Commercial ecosystem revenue instead flows to third parties it partners with (Crowdin, i18nexus) who sponsor the project.

## Strengths
- Deep, idiomatic RSC/App Router integration — treated by the Next.js community as the de facto standard i18n library for App Router (unlike Next.js's own deprecated built-in i18n routing, which a Next.js maintainer confirmed doesn't work properly in App Router).
- Strong type-safety story via TypeScript augmentation of message keys and (optionally) ICU argument shapes.
- Holistic scope: routing, formatting (dates/numbers/lists/relative time), RTL guidance, and translation in one package rather than requiring separate libraries.
- Standards-based (ICU, ECMA-402) rather than inventing a proprietary message syntax, easing TMS interoperability and migration.
- Large, active install base (~4M weekly downloads) and a fast release cadence (90 releases since 2020) with a responsive maintainer (community praise for quick patch turnaround).

## Weaknesses & criticism
- Single-maintainer bus factor: one person (Jan Amann) driving a library with 4M weekly downloads; sponsorship is small (8 sponsors, goal of 15) relative to adoption scale — sustainability risk (sourced: GitHub Sponsors page).
- Next.js lock-in: not usable as a portable solution across meta-frameworks; teams that later diversify off Next.js must fall back to the lower-level `use-intl` and rebuild routing/RSC integration themselves.
- `useExtracted` extraction pipeline (the closest analog to Palamedes' approach) is explicitly experimental/`unstable_`-prefixed APIs, with concrete reported friction (GitHub Discussion #2036, Issue #2087 "Stabilize useExtracted"):
  - Non-deterministic PO file ordering across rebuilds causing spurious git diffs.
  - No default-locale fallback for missing translations (renders empty string).
  - `msgid` holds an auto-generated key, not the literal source string — inverts normal gettext/PO convention and was called out by users as harder to scan than source-string-keyed PO files.
  - Static-analysis constraints are strict: no passing `t` to helper functions, no dynamic key lookup, no cross-boundary re-export — limits refactoring patterns common in larger codebases.
  - Monorepo/shared-component-library extraction has reported rough edges (wrapped imports, shared locale-type constants not referenceable in config).
- Historical churn around major versions: v4's ESM-only switch broke `createMiddleware`/`createNavigation` imports for some `moduleResolution` configs (GitHub Discussion #1631), requiring point releases and workarounds (`transpilePackages`).
- Ongoing compatibility friction with fast-moving Next.js internals: reported breakage with Next.js 16 + `use cache` directive (headers-inside-cache errors), Turbopack config-file resolution errors ("Couldn't find next-intl config file"), and third-party alternative runtimes (e.g., Cloudflare's `vinext`) reporting incompatibility.
- Mandatory-provider ergonomics questioned by users: whether the entire app must be wrapped in `NextIntlClientProvider` and the performance implications of doing so were raised without a fully resolved answer in the v4 feedback thread.
- General Next.js App Router i18n performance concerns exist at the framework level (separate `vercel/next.js` discussion #75928 reports 10x latency increase with i18n routing enabled at the Next.js config level, unrelated to next-intl specifically, but relevant context for any i18n-in-App-Router approach, including next-intl's own middleware-based routing).

## What they do differently
- Ships two parallel, incompatible message-identity models simultaneously: legacy explicit-key JSON (stable) and an experimental compiler-driven source-string extraction system (`useExtracted`) bolted on top via Webpack/Turbopack loaders — rather than a single, unified runtime model. The extraction is a **build step that erases itself**: `t('Literal text')` compiles down to a plain key lookup, so the "source-string" ergonomics only exist at author-time, not at runtime.
- Explicitly frames the PO/extraction feature as "Tailwind-inspired" utility-first design applied to i18n (inline colocation, no manual naming, dead-code elimination, minified footprint) and frames the whole effort as a bet on AI-agent-authored UI code — i.e., the redesign rationale is "what would an AI-friendly i18n API look like," rather than a human-DX-first rationale.
- Deliberately inverts standard PO convention by putting an auto-generated hash in `msgid` instead of the source string — a notable deviation from gettext norms (and from Palamedes' own source-string-as-identity model), motivated by wanting stable IDs even if the English source text changes.
- Routing/locale-in-URL is treated as inseparable from the library's core value proposition (SEO-indexable localized paths, domain-based routing) rather than a bolt-on integration — this is unusually deep compared to i18n libraries that stay purely at the string/formatting layer.
- Business model is pure maintainer sponsorship at very small scale (single-digit sponsor count) despite outsized adoption — no corporate/foundation backing, no hosted product, revenue asymmetry is stark relative to its ~4M weekly downloads.
- Commercial ecosystem play is via sponsor-vendor alignment (Crowdin, i18nexus fund the maintainer and are the recommended/first-party-documented TMS integrations) rather than next-intl building or monetizing its own translation-management tooling.

## Sources
- https://registry.npmjs.org/next-intl/latest (accessed 2026-07-06)
- https://api.npmjs.org/downloads/point/last-week/next-intl (accessed 2026-07-06)
- https://api.npmjs.org/downloads/point/last-week/use-intl (accessed 2026-07-06)
- https://next-intl.dev (accessed 2026-07-06)
- https://next-intl.dev/docs/getting-started (accessed 2026-07-06)
- https://next-intl.dev/docs/getting-started/app-router (accessed 2026-07-06)
- https://next-intl.dev/docs/routing (accessed 2026-07-06)
- https://next-intl.dev/docs/usage/messages (accessed 2026-07-06)
- https://next-intl.dev/docs/usage/extraction (accessed 2026-07-06)
- https://next-intl.dev/blog/use-extracted (accessed 2026-07-06)
- https://next-intl.dev/docs/environments/server-client-components (accessed 2026-07-06)
- https://next-intl.dev/docs/environments/core-library (accessed 2026-07-06)
- https://next-intl.dev/docs/workflows/typescript (accessed 2026-07-06)
- https://next-intl.dev/docs/design-principles (accessed 2026-07-06)
- https://github.com/amannn/next-intl (accessed 2026-07-06, via GitHub API: stars 4311, forks 361, open issues 52, created 2020-11-20)
- https://github.com/amannn/next-intl/releases (accessed 2026-07-06)
- https://github.com/amannn/next-intl/issues/2087 "Stabilize useExtracted" (accessed 2026-07-06)
- https://github.com/amannn/next-intl/discussions/2036 "useExtracted feedback" (accessed 2026-07-06)
- https://github.com/amannn/next-intl/discussions/1631 "Feedback for v4" (accessed 2026-07-06)
- https://github.com/amannn/next-intl/issues/2271 "Usage of useExtracted with use-intl" (accessed 2026-07-06)
- https://github.com/sponsors/amannn (accessed 2026-07-06)
- https://github.com/vercel/next.js/discussions/75928 (accessed 2026-07-06)
- https://next-intl.dev/docs/workflows/localization-management (accessed 2026-07-06)

Not verified: exact next-intl vs use-intl version parity (single latest version pulled per package independently, not cross-checked release-by-release); contributor count on GitHub repo (page load error during fetch); claimed enterprise users (Node.js, Todoist, Uber, Ethereum, Solana) beyond the homepage's own testimonial/logo claims.
