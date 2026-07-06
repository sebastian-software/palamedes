---
title: locize
category: tms
analyzed: 2026-07-06
analyzed_versions: "SaaS, feature state as of 2026-07-06"
homepage: https://www.locize.com
repository: n/a (proprietary; SDKs under github.com/locize)
---

# locize

## Fact sheet

| Fact                | Value                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| Company / ownership | inweso GmbH (Switzerland); run by the i18next maintainers; no VC                                          |
| License / model     | Proprietary SaaS; revenue explicitly funds i18next OSS development                                        |
| Pricing model       | Fixed tiers $0–$199/mo (words, languages, CDN downloads) + usage-based plan; AI/MT metered per token/char |
| Adoption            | ~86k npm downloads/week (backend SDK); Capterra 4.4/5 (22 reviews) — small footprint                      |
| TMS vs. AI-first    | TMS (i18next-native) with optional AI/MT auto-translation                                                 |
| Source of truth     | Hosted namespace/key DB with versioning                                                                   |
| Delivery            | Runtime CDN (OTA) — translations fetched at runtime, no rebuild                                           |
| ICU MessageFormat   | Yes — native format (for react-intl/next-intl/Lingui clients)                                             |
| .po / gettext       | Yes — via converter/CLI export (keys/values only; file structure not preserved)                           |
| Dev tooling         | locize-cli, REST API, GitHub Action, MCP server (2026)                                                    |
| Self-hosting        | No (enterprise-only per vendor comparison)                                                                |
| Notable             | `saveMissing` runtime key harvesting instead of static extraction; in-context editor via URL param        |

## Snapshot

- Maintainer / company / funding: run by **inweso GmbH**, a Swiss LLC (CHE-412.131.272) registered 24 Oct 2012, HQ Altnau, Switzerland. Publicly named principals: Jan Mühlemann (chair, claims "creator of i18next") and Adriano Raiano / "adrai" (managing director, most visible i18next/locize maintainer). A third registry shareholder exists but is unverified (paywalled record). Company states it has no VC funding; positions locize revenue as what funds continued i18next OSS development.
- License / business model: proprietary SaaS, usage-based pricing (see Pricing) plus a fixed-tier ladder; 14-day trial, no card required.
- Product state as of analysis date: mature, actively shipping — 10-year anniversary post (May 2026) and new AI/MCP features shipped in 2026.
- Adoption signals: `i18next-locize-backend` GitHub repo has 78 stars / 22 forks, `locize-cli` 71 stars (modest, not a strong public signal). No active Reddit/Hacker News discussion threads found — low public discourse volume outside vendor-authored comparison pages. npm weekly downloads (api.npmjs.org, week 2026-06-29–07-05): `i18next-locize-backend` 85,700; `locize-cli` 46,478; `locize-lastused` 24,879; `locize` (in-context editor script) 16,382; `locize-editor` 7,115 — roughly two orders of magnitude below i18next core (~15M/week). Latest `i18next-locize-backend` npm version is 10.0.1; `locize-cli` latest release v12.3.1 (2026-06-18). Review aggregators: Capterra 4.4/5 (22 reviews; sub-scores: Ease of Use 3.9 — lowest, Features 4.3, Support 4.5 — highest, Value 4.3); G2 only 2 reviews (~3.5/5) — thin samples. Self-reported customer logos: ABB, fuboTV, Swiss Red Cross, ZKB, Packlink, carVertical (vendor claim, not independently verified).
- Founded / age: i18next library created 2011; locize platform launched 2016 ("a small backend for i18next that did one thing: ship translations to running apps without a redeploy"); ~10 years old as of 2026.

## Positioning & target audience

- Tagline-level positioning: "One platform to localize your whole product" / "Ship translations without redeploying your app."
- Sells itself explicitly on i18next lineage: "The creators of i18next are also the founders of Locize" — marketed as "the deepest integration in the industry."
- Targets teams already on i18next (or willing to adopt it) who want a hosted TMS layered on top, plus adjacent React/Vue/Angular/Next.js ecosystems.
- Also markets to non-JS backends (iOS, Android, PHP, Python, Java, .NET) via REST API/CLI, and to design teams via a Figma plugin.

## Core concepts & architecture

- Namespace/key model: standard i18next namespace + key structure; per-plan limits on namespace count (see Pricing).
- Versioning: a project has a `latest` default version plus arbitrary custom versions (e.g. staging/production), created via "overwrite" or selective "copy" of another version. Enterprise-tier plans get more version/branch/tenant headroom.
- CDN delivery at runtime: two CDN tiers.
  - **Standard CDN** — `api.lite.locize.app`, Bunny CDN-backed.
  - **Pro CDN** — `api.locize.app`, CloudFront-backed, supports custom `Cache-Control max-age`.
  - URL pattern: `GET /{projectId}/{version}/{language}/{namespace}`.
  - Auto-publish to CDN is the default behavior (toggle-able per version) — this is the core architectural bet: translations update at runtime via CDN fetch, not via app rebuild/redeploy.
- i18next coupling: native/primary integration via `i18next-locize-backend` (current) — deep enough that locize documentation treats i18next as the reference client. Non-i18next frameworks are supported via separate, thinner integrations (see below), and a framework-agnostic runtime script `locizify` exists for non-i18next use.
- Production guidance explicitly warns against shipping API keys client-side and against leaving `saveMissing`/`add`/`update` enabled in production.

## Developer workflow & tooling

- **CLI**: `locize-cli` — import/export/sync translations, plus a `save-missing` command (CI/build-time equivalent of runtime missing-key capture).
- **API**: REST API for CRUD on translation content; used by first-party SDKs and any custom backend integration.
- **In-context editor**: activated via a URL query parameter (e.g. `?incontext=true`) — not a browser extension. Two modes:
  1. An injected overlay/popup rendered directly on the live page (draggable, persists position, detects SPA route changes).
  2. An iframe embed of the target site inside the locize.app dashboard (URL configured per project).
     Communication between host page and editor UI uses the browser `postMessage` API; the exact wire schema is not publicly documented. Key matching relies on invisible metadata in text nodes, `data-i18n` attributes, or raw text lookup.
- **Save-missing-keys flow**: with i18next's `saveMissing: true`, an unknown key triggered by `t(key)` at runtime POSTs to `/missing/{projectId}/{version}/{language}/{namespace}` (requires `apiKey` + `referenceLng`). By default only `localhost` may send missing keys; other hosts require explicit whitelisting via `allowedAddOrUpdateHosts`. Missing keys land as **draft/unpublished** content and only reach the CDN once the version is published (auto-publish or manual).
- **CI**: `locize-cli` is designed for CI pipelines (import/export/sync commands); no dedicated GitHub Action product found, but CLI-based CI integration is documented.
- **MCP server**: a Locize MCP server exists for agent workflows (Claude, Cursor, VS Code) — announced 2026 ("One command from hardcoded strings to a localized app," Jun 2026).

## Supported file formats & interop

- Native/current integrations: i18next (primary), React, Vue, Angular, Next.js, Node.js, iOS, Android, PHP, Python, Java, .NET.
- Framework-native examples/support: react-intl/FormatJS, next-intl, vue-i18n, ngx-translate, Transloco (Angular), Astro, Nuxt, Remix, React Router, Gatsby.
- Deprecated/legacy integrations: js-lingui, standalone FormatJS, Polyglot.
- File format converters: XLIFF, Gettext, Android strings XML, RESX, Fluent, TMX, Laravel PHP arrays, `.xcstrings` (iOS). `locize-cli download` supports: json/nested/flat, xliff2/xliff12, android, yaml (+rails), csv, xlsx, **po**, strings, resx, fluent, tmx, laravel, properties, xcstrings.
- Export/off-boarding fidelity caveats (from locize docs): "locize generally only handles the translation content, i.e. keys and values, and never saves your imported file with the original file structure" — round-tripping preserves keys/values, not structural metadata/comments; "no sort of i18n format conversion while importing or exporting". Full metadata (tags, context, quality flags, review states) is only documented on the `/pull/` API endpoint, not the standard download path. ToS commits to 10 days' notice and "help" retrieving data on termination, but no guaranteed format/procedure. Official GitHub Action: `locize/download@v2`. Documented `locize-cli` bugs around export fidelity exist (invalid yaml-rails output #27, PO plural-form issues #30, sync not updating keys #64).
- Onboarding: official "Migrating from X to locize" guides exist for Transifex, Phrase, Lokalise, Localazy, Tolgee; i18next migration is a 2-step swap (`i18next-locize-backend` + `locize migrate`). No official "migrate away from locize" guide exists — export is via CLI download only.
- Figma plugin for design-side string sync.

## AI features

- Feature name: "Automatic Translation" (not branded "autopilot").
- MT/AI providers: OpenAI, Google Gemini (Pro/Flash), Mistral AI, Lara (Translated), Google Translate, DeepL, MyMemory, plus locize's own "Locize AI" and "Locize MT" services. Bring-your-own-API-key supported for third-party providers.
- Mechanics: only new/missing keys are auto-translated by default (not retroactive translation of existing content); can be triggered via `saveMissing`, the API, or the MCP server. Project glossary/style guide is injected into prompts. "Quality Estimation" provides per-translation confidence scores with optional human-review routing.
- Pricing for built-in AI: Locize AI $0.000008/token; Locize MT $0.000030/character (see Pricing).
- Recent 2026 content: "When AI Translations Break..." (Jul 2026), "One command from hardcoded strings to a localized app" (Jun 2026), an EU AI Act analysis of MT (Jun 2026), a browser-native-translation comparison (Jun 2026), and a 2026 announcement of a new Free plan.
- Not verified: original launch date of the AI features; whether "Locize AI"/"Locize MT" are proprietary models or a white-labeled pass-through.

## Pricing

(All figures USD; no EUR pricing found. Source: locize.com/pricing, fetched 2026-07-06.)

**Fixed monthly tiers:**
| Plan | Price/mo | Words | Languages | Namespaces | Users | Standard CDN downloads |
|---|---|---|---|---|---|---|
| Free | $0 | 2,000 | 2 | 5 | 1 | 100K |
| Starter | $7 | 15,000 | 5 | 10 | 5 | 1M |
| Starter-Plus | $19 | 30,000 | 7 | 25 | 5 | 3M |
| Growth | $49 | 60,000 | 10 | 50 | 10 | 5M (+150K Pro CDN, 1.5K private) |
| Professional | $99 | 100,000 | 20 | 75 | Unlimited | 7M (+250K Pro CDN, 2.5K private) |
| Professional-Plus | $149 | 150,000 | 50 | 150 | Unlimited | 10M (+350K Pro CDN, 3.5K private) |
| Enterprise | $199 | 200,000 | 150 | 300 | Unlimited | 15M (+500K Pro CDN, 5K private) |

**Overage pricing (pay for what exceeds plan quota):**

- Standard CDN: $5.00 per 1M downloads
- Pro CDN: $5.00 per 100K downloads
- Private downloads: $5.00 per 10K downloads
- Words (Enterprise): $5.00 per 10K words
- Branches: $5.00 per 5 branches
- Tenants: $10.00 per 5 tenants

**Add-ons:**

- SAML SSO: $20/mo
- Standard backup: $8/mo
- Pro backup: $25/mo
- Locize AI: $0.000008/token
- Locize MT: $0.000030/character

**Separate usage-based plan:** $5/mo base fee (includes 1M standard CDN downloads free/month), unlimited languages/users/namespaces, metered by words stored, modifications, and downloads. Exact per-unit rates for this alternate plan varied by source and were not independently confirmed on the live pricing page at fetch time — treat as directionally correct, not verified.

## Strengths

- Runtime CDN delivery means translation updates ship without an app redeploy — genuinely different mechanism from build-time catalog compilation.
- Deepest available integration with i18next specifically (same team builds both), including automatic missing-key capture during development.
- In-context editing without requiring a browser extension (URL-param + postMessage overlay/iframe).
- Broad file-format import/export coverage (XLIFF, Gettext, Android, RESX, Fluent, TMX, Laravel, xcstrings).
- Usage-based pricing option avoids seat-based minimums (contrasts with Lokalise's more sales-led/seat model per comparison pages).
- No VC funding — company frames this as insulating product decisions from investor pressure.

## Weaknesses & criticism

(Source: Capterra review snippets, G2 alternatives page, vendor comparison pages — locize.com/compare/locize-vs-crowdin/, locize.com/compare/locize-vs-lokalise/)

- Platform described in some reviews as "very slow"; Capterra reviewers report "performance issues with large projects", "slow search / no deduplication", "poor backup functionality; limited automation".
- UI dated/clunky is the most recurring theme across otherwise-positive Capterra reviews ("UI design feels outdated and clunky", "UI quality doesn't match product quality", "application needs redesign"); Ease of Use is the weakest Capterra sub-score (3.9/5). locize itself shipped a full UI rebuild ("all-new locize.com"), implicitly acknowledging this.
- Described as "costly" by some users; pricing model called "confusing" in reviews — locize's own docs include a page titled "Why is the pricing so complicated?". One documented independent migration-away story (Medium, Irfan Khan) cites subscription cost as the driver for replacing locize with a custom i18next + GitHub Actions + GPT-4 pipeline.
- One reported incident of being charged after account deletion, support called "rude" (single 1/5 Capterra review, Feb 2020, not independently corroborated; support otherwise rates 4.5/5).
- The i18next v25.8 "support notice" episode (console ad for locize in the OSS library, removed in v26 after backlash — GitHub issues i18next#2385/#2387/#2390) is independent evidence of the OSS/SaaS coupling risk.
- Documentation criticized repeatedly ("could be more intuitive", "needs improvement"; locize-editor migration-docs gap in locize-editor#23).
- Very low independent public discourse: no substantive Reddit or Hacker News threads found discussing locize — most available commentary is vendor-authored (locize's own comparison pages) or short-form review-site snippets, which limits independent verification of the above complaints.
- Tight i18next coupling cuts both ways: best-in-class for i18next users, but a lock-in vector — switching i18n runtime libraries later means re-plumbing the TMS integration too.

## What they do differently

- **Runtime CDN delivery vs. build-time catalogs**: translations are fetched from a CDN at runtime (with versioning/publish steps) rather than compiled into the app at build time — this is the core architectural difference from source-string-first, build-time `.po`-catalog approaches. It enables "ship a copy fix without redeploying," at the cost of a runtime network dependency and a publish/versioning workflow layered on top of the translation data itself.
- **OSS-funding-by-SaaS model**: locize explicitly positions its commercial revenue as the funding mechanism for i18next's continued open-source development, and states it has taken no VC funding — a direct commercial/OSS coupling that is unusual and creates a structural conflict of interest (the SaaS vendor also controls the "neutral" OSS library's roadmap and defaults).
- **In-context editing via URL param + postMessage**, not a browser extension — lower friction to enable per-environment, but requires the app to load an editor script/allow the overlay.
- **Automatic missing-key harvesting during development** (`saveMissing`) as the default content-creation workflow, rather than static extraction from source — keys are discovered by exercising the running app in development, landing as unpublished drafts until a version is explicitly published.
- **Granular usage-based metering** (words stored, modifications, CDN downloads, private downloads, AI tokens/characters, branches, tenants) rather than flat per-seat or per-word-translated pricing alone — pricing surface area is unusually multidimensional compared to typical TMS competitors.
- **Very small, low-visibility company** (Swiss GmbH, small team, minimal GitHub star counts on SDKs, near-zero Reddit/HN presence) relative to funded competitors like Lokalise, Crowdin, Phrase — adoption signals are weak/hard to verify independently.

## Sources

- https://www.locize.com (accessed 2026-07-06)
- https://www.locize.com/pricing (accessed 2026-07-06)
- https://www.locize.com/i18next (accessed 2026-07-06)
- https://www.locize.com/docs/integration/api (accessed 2026-07-06)
- https://www.locize.com/docs/cdn/ (accessed 2026-07-06)
- https://www.locize.com/docs/versioning (accessed 2026-07-06)
- https://www.locize.com/docs/general-questions/i18next-vs-locize/ (accessed 2026-07-06)
- https://www.locize.com/docs/guides/going-to-production (accessed 2026-07-06)
- https://www.locize.com/features/in-context-editor (accessed 2026-07-06)
- https://www.locize.com/ai/ (accessed 2026-07-06)
- https://www.locize.com/docs/automatic-translation/ (accessed 2026-07-06)
- https://www.locize.com/blog/10-years-of-locize/ (accessed 2026-07-06)
- https://www.locize.com/blog/i18next-support-notice (accessed 2026-07-06)
- https://www.locize.com/compare/locize-vs-crowdin/ (accessed 2026-07-06)
- https://www.locize.com/compare/locize-vs-lokalise/ (accessed 2026-07-06)
- https://github.com/locize/i18next-locize-backend (accessed 2026-07-06)
- https://github.com/locize (org, 68 repos) (accessed 2026-07-06)
- https://www.northdata.com/inweso+GmbH,+Altnau/CHE-412.131.272 (accessed 2026-07-06)
- https://medium.com/@jamuhl/im-the-creator-of-http-i18next-com-a7296d8ada9c (accessed 2026-07-06)
- https://www.capterra.com/compare/162858-180753/Lokalise-vs-Locize (accessed 2026-07-06)
- https://www.g2.com/products/locize/competitors/alternatives (accessed 2026-07-06)
- https://www.g2.com/products/locize/reviews (accessed 2026-07-06)
- https://www.capterra.com/p/180753/Locize/ and /reviews/ (accessed 2026-07-06)
- https://github.com/locize/locize-cli (accessed 2026-07-06)
- https://github.com/i18next/i18next/issues/2385, /2387, /2390 (accessed 2026-07-06)
- https://medium.com/@khanzzirfan/automating-localization-translations-with-ai-how-we-replaced-locize-with-a-custom-github-actions-workflow-96f6e8c440aa (accessed 2026-07-06)
- https://www.locize.com/docs/guides/migrating-from/ (accessed 2026-07-06)
- https://www.locize.com/terms/ (accessed 2026-07-06)
- api.npmjs.org weekly download counts for locize packages (accessed 2026-07-06)
