---
title: Tolgee
category: hybrid
analyzed: 2026-07-06
analyzed_versions: "tolgee-platform v3.209.1 (2026-07-01); @tolgee/core v7.1.1; @tolgee/react v7.1.1"
homepage: https://tolgee.io
repository: https://github.com/tolgee/tolgee-platform
---

# Tolgee

## Fact sheet

| Fact                | Value                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Company / ownership | Tolgee s.r.o., Brno (Czechia); ~€500K seed + Czech public grants                                                                                                                           |
| License / model     | Open-core: Apache-2.0 platform + proprietary `ee/` (Tolgee EE License); MIT SDKs                                                                                                           |
| Pricing model       | Cloud €0 / €49 / €179 / €499 / custom per month (keys + seats + MT credits); self-host free ≤10 seats                                                                                      |
| Adoption            | 4.0k GitHub stars; ~123k npm downloads/week (@tolgee/core); Capterra 4.6/5 (95 reviews)                                                                                                    |
| TMS vs. AI-first    | TMS with AI translator (GPT-based, automatically context-fed)                                                                                                                              |
| Source of truth     | Platform key/translation DB; files are import/export targets                                                                                                                               |
| Delivery            | SDK/CDN + file export                                                                                                                                                                      |
| ICU MessageFormat   | Yes — native platform-wide, plural-aware editor UI                                                                                                                                         |
| .po / gettext       | Yes — one among many formats                                                                                                                                                               |
| Dev tooling         | CLI (extraction, push/pull), REST API, official MCP server built into the platform (MCP Registry; Claude Code/Desktop, Cursor; single "Developer" role — early-stage; verified 2026-07-06) |
| Self-hosting        | Yes (Docker; core features free)                                                                                                                                                           |
| Notable             | ALT+click in-context editing with automatic screenshot capture feeding AI context                                                                                                          |

## Snapshot

- Maintainer / company / funding: Tolgee s.r.o., Brno, Czech Republic. Founded by Jan Cizmar (CEO, project started ~2019 as a master's thesis); co-founders Marketa (COO) and Stepan (advisor). Core team ~9 people plus external/OSS contributors. Funding: ~€500K seed round from Flying Founders; additional non-dilutive support via CzechInvest Technology Incubation and CzechInvest Internationalization (EU National Recovery Plan) programs. No large VC round disclosed.
- License / business model: dual-licensed. Core platform (majority of code) is Apache License 2.0. Enterprise-only code lives in `ee/` and `webapp/src/ee` directories under the proprietary "Tolgee EE License V1" — non-commercial use only unless a paid license key is purchased; official Docker images/binaries bundle the EE code (inactive without a key). JS SDKs (`@tolgee/core`, `@tolgee/react`, etc.) are MIT licensed. Business model: open-core SaaS (Tolgee Cloud) + paid self-hosted licenses for enterprise features.
- Current stable version + release date: platform v3.209.1, released 2026-07-01 (bug-fix release for XLSX/CSV import validation); repo shows 977 releases total. `@tolgee/core` and `@tolgee/react` both at v7.1.1 on npm.
- Adoption: GitHub stars 4,017; forks 363; open issues 198 (tolgee/tolgee-platform, accessed 2026-07-06). npm weekly downloads (2026-06-29 to 2026-07-05): `@tolgee/core` 122,718; `@tolgee/react` 89,539. Capterra rating 4.6/5 from 95 verified reviews. Vendor claims "40,000+ users" (unverified, vendor figure). Repo created 2020-10-13.
- Founded / age: project started late 2019, company operating since ~2020-2021; roughly 5-6 years old as of 2026.

## Positioning & target audience

- Markets itself explicitly as "an open-source alternative to Crowdin, Phrase, or Lokalise" — positioned as a hybrid: open-source + hosted TMS, not a pure runtime library.
- Targets developer teams that want in-app/in-context translation editing without excessive file round-tripping, plus non-developer stakeholders (translators, PMs, clients) who need a no-code way to edit strings directly on the running application.
- Competes against both commercial TMS incumbents (Crowdin, Lokalise, Phrase) and i18next-ecosystem tooling (locize, built by i18next's own creators) — Tolgee explicitly differentiates from locize by owning a full custom SDK stack rather than being an i18next-native backend.
- Pitched heavily at React/Next.js/Vue/Angular/Svelte web teams plus mobile (Android/iOS/Flutter) and games (Unreal Engine); JS/web is the primary wedge, with framework-agnostic REST API and CLI for everything else.

## Core concepts & architecture

- Key-based translation model: strings are stored/managed as keys with associated translations per language, plus optional per-key metadata (description, tags, screenshots, comments).
- SDK <-> platform coupling: proprietary Tolgee SDKs (`@tolgee/core`, `@tolgee/react`, plus Vue/Angular/Svelte wrappers) are the primary client; an i18next integration exists as a bridge/plugin rather than i18next being a first-class citizen. This is a tighter platform-to-SDK coupling than i18next-native tools like locize.
- In-context editing mechanism: ALT+click (configurable) on any rendered string in a running app (dev or production, given the SDK is wired in) opens an in-context edit dialog; the SDK intercepts the click, resolves the DOM node back to its translation key, and lets the user edit/save the translation live via the platform API — no page rebuild needed for the editing session itself.
- Screenshots as context: users can manually upload up to 20 screenshots per translation key; additionally, the ALT-click dialog has a one-click "camera" button that uses the browser Canvas API to auto-capture a screenshot of the live app, highlight the specific phrase, and upload it as context for translators/AI — this automatic-capture workflow is a distinctive mechanic (most competitors, e.g. Crowdin, only support manual screenshot upload).
- ICU support: all Tolgee SDKs and the platform use ICU MessageFormat natively for plurals, select, and nested plural/select combinations (e.g., gender + count). The platform has a dedicated plural editor UI (per-form inputs) so translators don't need to hand-edit ICU syntax; also documents a "Tolgee Universal ICU Placeholders" convention for cross-format placeholder consistency.
- Browser extension (Chrome/Firefox) additionally allows in-context editing on production sites without a bundled dev-mode wrapper, by injecting into the page.
- Notable weakness flagged by a competitor (locize) comparison: Tolgee's editor "treats translations as raw text" without deep framework-specific plural/nesting awareness compared to locize's i18next-native editor — not independently verified beyond that comparative source.

## Framework & platform support

- Web: React, Next.js, Angular, Vue, Svelte, vanilla JS; i18next plugin/bridge for teams already on i18next.
- No dedicated TanStack Start, SolidStart, Waku, or React Router SDK found in official docs/integrations list as of 2026-07-06 (Palamedes explicitly supports these) — Tolgee's meta-framework coverage is narrower, centered on React/Next.js/Angular/Vue/Svelte.
- Mobile: native Android SDK, native iOS SDK, Flutter (.arb).
- Game engines: Unreal Engine integration listed.
- Backend/generic: REST API, CLI (string extraction + push/pull sync), PHP/Gettext, generic JSON.
- Design tooling: Figma plugin (pull design-stage strings into the workflow); Slack integration for notifications.

## Catalog formats & interop

- Generic interchange formats: structured JSON, XLIFF, GNU Gettext .po (also PHP/C variants), .properties, YAML (structured), CSV, XLSX.
- Framework-specific formats: Tolgee Native JSON (ICU-based, native to JS SDKs), Apple .strings/.stringsdict, Apple String Catalog (.xcstrings, Xcode 15+), Apple XLIFF (platform notes Apple's own XLIFF import is strict/brittle), Android resource XML (plurals/arrays supported), Compose Multiplatform XML, Flutter .arb, Rails YAML, i18next JSON, .NET RESX.
- Most of this broad format matrix was added starting platform v3.49.0 per docs; ICU message format is preserved across most generic formats on import/export.
- .po/Gettext is supported as one format among many (PHP and C/C++ variants specifically called out) but is not treated as the sole source of truth the way Palamedes treats source-string-first .po catalogs — Tolgee's source of truth is the platform's own key/translation database, with file formats as import/export targets.

## Workflow & tooling

- CLI: project setup, string extraction from source code, push/pull sync between repo and platform.
- Self-hosting: Docker is the documented easiest path. Minimum spec 2 CPU / 4GB RAM; recommended 4 CPU / 16GB RAM / 20GB disk. Free self-hosted tier includes core localization features, machine translation via your own API keys, and up to 10 seats; SSO and granular permissions require a paid license.
- Self-hosted operators are responsible for their own database management, backups, and security patching (no managed infrastructure) — flagged by a competitor comparison (locize) as a real operational cost ("choosing Tolgee often means choosing a new job: Infrastructure Management" — locize's framing, not independently verified as neutral).
- CI/CD: no dedicated GitHub Action beyond CLI-based scripting found; translation memory with similarity matching, activity log/history, and comments on translations are built into the platform for team review workflows.
- Branching (git-like translation branches) and granular permissions are gated to paid tiers (Business tier and above per pricing page).

## AI features

- Tolgee AI Translator: built on GPT-family models (ChatGPT per docs); pulls context automatically from screenshots, "Tolgee Context" (auto-extracted UI context), key descriptions, project descriptions, language notes, and translation memory results — positioned as reducing the need for developers/designers to manually write context per key.
- Automatic screenshot capture (Canvas API-based, described above) directly feeds the AI translator's context pipeline.
- AI Playground (test/tune prompts) is gated to the Business tier and above.
- Machine translation credit model: roughly 1 credit per translated character for standard MT providers (DeepL, Google Translate, AWS Translate supported), or a token-based AI cost (~0.08 credit per input token / 0.3 credit per output token) for LLM-based translation.
- Per a third-party comparison (locize), Tolgee restricts to "5 LLM providers" and gates AI playground/prompt testing to enterprise-level tiers, with "no styleguide-aware AI" — not independently re-verified beyond that source.
- MCP server (verified 2026-07-06): official and real — an MCP endpoint built into the platform itself (`https://app.tolgee.io/mcp/developer` on Cloud, also available on self-hosted instances), registered in the MCP Registry as `io.github.tolgee/tolgee`; documented clients: Claude Desktop, Claude Code, Cursor, Windsurf, ChatGPT (remote HTTP + `X-API-Key` PAK/PAT auth, no OAuth). Early-stage scope: currently exposes a single "Developer" role (keys, translations, languages, tags, namespaces, branches, batch operations); translator/PM roles are "planned for future releases". Originated as a one-week-appetite feature pitch (tolgee-platform#3449). Not to be confused with the unaffiliated community repo `ytarfa/tolgee-mcp`.

## Pricing

(as published on tolgee.io/pricing, accessed 2026-07-06; annual billing assumed where "per month" tiers are shown, 2 months free on annual per site)

- Free (Cloud): €0/month — up to 500 keys, 3 seats, 10,000 MT credits, unlimited projects, standard localization features, integrations, no credit card required.
- Team: €49/month (billed annually) — 2,000 keys, 4 seats, AI translator with brand context, glossaries.
- Business: €179/month (billed annually) — 5,000 keys, 8 seats, adds AI playground, tasks, branching, granular permissions.
- Advanced: €499/month (billed annually) — 20,000 keys, 20 seats, adds professional translation integration and translation memory management.
- Enterprise: custom/contact sales — SSO, dedicated Slack channel, account manager, prioritized requests, ISO 27001 and GDPR compliance claims.
- Extra seats/keys beyond tier limits: pay-as-you-go add-on rates.
- Self-hosted: free community tier (core features, MT via own API keys, up to 10 seats) or paid monthly/annual license for enterprise features (SSO, granular permissions, higher seat counts) — exact self-hosted license price not published; "contact sales."

## Strengths

- Automatic in-app screenshot capture tied directly to the in-context ALT+click editor — a smoother context-gathering mechanic than manual-only screenshot upload (e.g., Crowdin).
- Broad catalog-format interop across mobile (Apple, Android, Flutter), backend (.NET RESX, Rails YAML), and web (JSON, i18next, XLIFF, PO) from a single platform.
- Native ICU MessageFormat support platform-wide, including a plural-aware editor UI and nested plural/select handling.
- Free self-hosting tier with core features unlocked (up to 10 seats) — lower barrier to self-host and evaluate than many commercial TMS competitors.
- Well-regarded developer UX per review aggregators (4.6/5 on Capterra, 95 reviews) — praised for interface simplicity and React integration specifically.
- Real, EU-grant-backed early-stage funding plus a Czech public-incubation track record suggests some financial runway beyond bootstrapping alone.

## Weaknesses & criticism

(sourced from Capterra reviews and a locize competitor-comparison page; themes, not independently re-verified line by line)

- Chrome/browser extension for in-context editing described by multiple Capterra reviewers as hard to configure without digging through documentation.
- Documentation gaps noted by reviewers — requests for more examples and clearer guidance on specific features.
- Limited third-party integrations: no native Jira, GitLab, or Zapier connectors called out as missing by reviewers (Slack and Figma are supported).
- Occasional performance/connection issues reported (slow file fetches, sporadic error messages) — anecdotal, not benchmarked.
- UI described as too mouse-dependent by some reviewers; keyboard-shortcut support requested.
- Free tier limits (500 keys/3 seats) called restrictive for early-stage/pre-revenue projects.
- Per locize's comparison page (vendor-interested source, treat as directional only): self-hosting requires operators to own their own database/backup/patching lifecycle (no CDN-backed global delivery like locize); proprietary SDK stack means no influence over the i18next ecosystem roadmap; editor treats translations as "raw text" without deep framework-specific plural/nesting awareness; AI features (multi-LLM choice, prompt playground) reserved for higher paid tiers; no multi-tenancy; branching gated to paid tiers.
- Official Docker images/binaries always bundle the proprietary EE code (dormant without a license key) — teams wanting a strictly Apache-2.0-only build must strip `ee/` directories and self-build, which is friction relative to a purely permissive-licensed competitor.

## What they do differently

- Automatic screenshot capture wired directly into the ALT+click in-context editor (Canvas API grabs and highlights the live UI element being translated) — turns "context for translators" from a manual chore into a one-click action, and feeds the same screenshot into the AI translator's context pipeline.
- Full custom SDK stack (not an i18next wrapper) — Tolgee owns the runtime format (ICU-based "Tolgee Native JSON") and framework bindings end-to-end, trading i18next-ecosystem compatibility for tighter platform/SDK integration and features like live in-context editing.
- Open-core self-hosting with a genuinely usable free tier (core features + up to 10 seats), governed by a bespoke "Tolgee EE License V1" that gates only the `ee/` enterprise-feature directories — a middle ground between fully proprietary SaaS (Crowdin/Lokalise) and fully permissive OSS.
- AI translation context is assembled automatically from multiple signals at once (screenshot + auto-extracted UI context + key/project descriptions + translation memory) rather than requiring translators or developers to manually annotate each string.
- Explicitly brands itself in opposition to both commercial TMS incumbents and to i18next-native tooling (locize), carving a distinct "open-source in-context TMS" niche rather than being purely a runtime i18n library or purely a hosted enterprise TMS.
- No meta-framework coverage for TanStack Start, SolidStart, Waku, or React Router — its web-framework bet is concentrated on React/Next.js/Angular/Vue/Svelte, narrower than Palamedes' explicit multi-meta-framework runtime model.

## Sources

- https://tolgee.io — accessed 2026-07-06
- https://tolgee.io/pricing — accessed 2026-07-06
- https://tolgee.io/about — accessed 2026-07-06
- https://tolgee.io/ee-license — accessed 2026-07-06
- https://tolgee.io/apps-integrations — accessed 2026-07-06
- https://github.com/tolgee/tolgee-platform — accessed 2026-07-06
- https://github.com/tolgee/tolgee-platform/releases — accessed 2026-07-06
- https://api.github.com/repos/tolgee/tolgee-platform — accessed 2026-07-06
- https://registry.npmjs.org/@tolgee/core/latest — accessed 2026-07-06
- https://registry.npmjs.org/@tolgee/react/latest — accessed 2026-07-06
- https://api.npmjs.org/downloads/point/last-week/@tolgee/core — accessed 2026-07-06
- https://api.npmjs.org/downloads/point/last-week/@tolgee/react — accessed 2026-07-06
- https://docs.tolgee.io/platform/self_hosting/getting_started — accessed 2026-07-06
- https://docs.tolgee.io/platform/supported_formats — accessed 2026-07-06
- https://www.capterra.com/p/10002120/Tolgee/reviews/ — accessed 2026-07-06
- https://www.locize.com/compare/locize-vs-tolgee — accessed 2026-07-06 (competitor-authored comparison; directional, not neutral)
- Web search results on Tolgee ICU message format / pluralization (docs.tolgee.io/platform/translation_process/icu_message_format, tolgee_universal_icu_placeholders, js-sdk/formatting) — accessed 2026-07-06
- Web search results on Tolgee company/funding (Crunchbase, Tracxn organization pages) — accessed 2026-07-06
- https://docs.tolgee.io/platform/integrations/mcp_server/about — accessed 2026-07-06 (MCP verification)
- https://github.com/tolgee/tolgee-platform/issues/3449 — accessed 2026-07-06 (MCP feature pitch)
