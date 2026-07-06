---
title: Lokalise
category: tms
analyzed: 2026-07-06
analyzed_versions: "SaaS, feature state as of 2026-07-06"
homepage: https://lokalise.com
repository: n/a (proprietary; OSS tooling under github.com/lokalise)
---

# Lokalise

## Fact sheet

| Fact                | Value                                                                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Company / ownership | Lokalise Inc. (Riga, 2017); ~$56M funding; now Adobe-owned via Semrush (2024/2026)                                                                                                |
| License / model     | Proprietary SaaS; two product lines (Expert = software, Vantage = content)                                                                                                        |
| Pricing model       | Since 11/2025: processed words/year; $144 / $375–499 / $999 / custom per month; 2 of 4 tiers sales-gated                                                                          |
| Adoption            | Claims ~1M users / 3,000+ companies (unverified)                                                                                                                                  |
| TMS vs. AI-first    | TMS with two-tier AI (Standard vs. RAG-based Pro AI) + AI LQA (DQF-MQM scoring)                                                                                                   |
| Source of truth     | Hosted keys (server-side projects/branches)                                                                                                                                       |
| Delivery            | File sync + OTA (GB-metered) with mobile SDKs                                                                                                                                     |
| ICU MessageFormat   | Partial — ICU plurals detected on import ("Detect ICU plurals") and converted to Lokalise's own CLDR plural editor; export can re-emit ICU; documented gaps (verified 2026-07-06) |
| .po / gettext       | Yes — incl. msgctxt, fuzzy flags, plurals                                                                                                                                         |
| Dev tooling         | lokalise2 CLI (Go), API v2 (strict rate limits reported), Figma/XD/Sketch plugins                                                                                                 |
| Self-hosting        | No                                                                                                                                                                                |
| Notable             | Design-tool workflow as differentiator; atypical 90-day cancellation notice period                                                                                                |

## Snapshot

- Maintainer / company / funding: Lokalise Inc., founded 2017 in Riga, Latvia by Nick Ustinov and Petr Antropov. Raised $6M Series A (Sept 2020, led by Mike Chalfen/Capital300) and $50M Series B (Dec 2021, led by CRV, with Creandum, Dawn Capital). Total disclosed funding ~$56M. Acquired by Semrush in 2024. Semrush itself was acquired by Adobe (deal completed ~April 2026) — Lokalise is therefore now, transitively, an Adobe-owned company.
- License / business model: proprietary closed-source SaaS TMS; usage/seat-based subscription. No self-hosted option.
- Product state as of analysis date: mature developer-oriented TMS, split into two product experiences — "Lokalise Expert" (software/product localization: keys, repos, API, CI/CD) and "Lokalise Vantage" (marketing/document content, e.g. help articles, campaigns) sharing one team subscription and usage pool. Recently (Nov 2025) underwent a full pricing/plan restructure.
- Adoption signals: vendor claims ~1 million users across 3,000+ companies; named customers include Life360, Pleo, CoachHub, DHL, HelloFresh, Hyundai, Shell (unverified beyond vendor's own claims). SOC 2 Type II, ISO 27001, ISO 27017, GDPR, HIPAA-aligned certifications claimed.
- Founded / age: 2017 (~9 years old as of 2026).

## Positioning & target audience

- Markets itself as a "developer-centric" / "AI-powered localization platform," historically differentiated from Crowdin/Transifex by API-first design and tighter CI/CD integration.
- Two distinct buyer personas addressed by two product lines: engineering/product teams (Expert: strings, branches, GitHub sync) and marketing/content teams (Vantage: documents, help center content, campaigns) — both live under one workspace/subscription.
- Targets mid-market to enterprise: Explorer/Growth tiers aim at smaller teams, Advanced/Enterprise (both gated behind a sales demo) aim at larger orgs needing SSO, dedicated support, and higher volume.
- Independent reviewers (e.g. better-i18n.com) explicitly frame Lokalise as a "cross-functional platform" rather than a strictly CLI/developer-first tool, noting the web UI is the primary interface and that per-seat costs scale poorly for orgs needing many non-engineer stakeholders (translators, PMs, reviewers) with access.

## Core concepts & architecture

- Central hosted "Project" per app/product; strings are stored as server-side keys with per-language values, not files-as-source-of-truth.
- Branching: projects support git-like "branches" inside Lokalise to isolate in-progress feature translations before merging back into the main branch — mirrors git branching but lives in Lokalise's own server-side model, not literal git branches.
- Translation Memory (TM): built-in, shared across all team projects/members; every edit made in the editor, via upload, or via API is automatically saved to TM for reuse.
- Glossary: stores preferred terms/definitions/example usage per language; highlighted inline in the editor. Independent reviewers (G2) describe glossary functionality as "very limited" — no automated check that a specific key actually used the correct glossary term (that gap is partly what AI LQA targets).
- Context & screenshots: screenshot upload with automatic text recognition links visual context to specific keys; Figma/Adobe XD/Sketch plugins push design frames directly into Lokalise so translators see real UI placement without manual screenshot handling.
- OTA (over-the-air) delivery: publishes translation bundles for mobile/web apps to fetch at runtime without an app-store rebuild/redeploy; usage metered in GB of OTA data transfer per plan tier.

## Developer workflow & tooling

- CLI: `lokalise2` (Go-based, ships as `lokalise-cli-2-go` on GitHub), a full rebuild of the original CLI providing CRUD access to essentially the whole API v2 surface (projects, keys, languages, files, translations) via subcommands, e.g. `lokalise2 file upload`, `lokalise2 file download`, `lokalise2 key list`. Config via token + project ID, or a YAML config file.
- API v2: REST API is the CLI's foundation; token-based auth (personal tokens inherit the user's own permissions across teams/projects). Reported (via independent commentary, not an official Lokalise doc page fetched directly) rate limit of 6 requests/second with 1 concurrent request per token — cited by developers as a source of 429 errors in CI pipelines with parallel jobs; treat exact figure as reported-but-not-directly-verified from an official current doc.
- GitHub/GitLab/Bitbucket/Azure Repos integration: two-way sync — new/changed strings pushed to a configured branch land in the Lokalise project automatically (converted to the target format), and Lokalise can push translations back as commits/PRs.
- SDKs: OTA SDKs for iOS, Android, and Flutter to pull published translation bundles at runtime; a public OTA API is available to build custom SDKs for other platforms/frameworks.
- Figma plugin: import Lokalise translations into Figma frames with one click, preview any language directly in the design file — reduces design/localization handoff friction (called out repeatedly in third-party reviews as a genuine strength).
- 60+ listed integrations overall (dev tools, Jira, WordPress, Webflow, Contentful, Slack, etc. — vendor-stated count, not independently re-counted).

## Supported file formats

- Vendor claims 30–50+ file formats depending on source page (homepage says "30+", other pages/reviews say "50+" — inconsistent, treat exact count as unverified).
- Confirmed formats include: Gettext (.po, .pot) — parses `msgid`/`msgid_plural`/`msgstr`/`msgctxt`/comments/fuzzy flags; plural forms supported on import; on export, ICU plural format can be selected to preserve original .po plural structure. Obsolete (`#~`) entries are not imported.
- Structured/flat/nested JSON, Qt Linguist (.ts), XLIFF (.xlf/.xliff), Application Resource Bundle (.arb), Android XML strings, iOS .strings/.stringsdict.
- ICU MessageFormat (verified 2026-07-06): supported via detection/conversion, not raw ICU editing — an explicit "Detect ICU plurals" upload option converts ICU plural expressions into Lokalise's native CLDR plural-category model (editing happens in Lokalise's per-form plural UI, not in ICU syntax); export can re-emit ICU (`--plural-format icu`, one of printf/ios/icu/net/symfony/i18n/raw). Documented gaps: detection "may not function as expected" for plurals embedded in larger strings (Lokalise's own blog), and named ICU placeholders do not map automatically to positional universal placeholders (numeric placeholders recommended).
- Some formats are gated by product line: e.g. JSON upload documented as available only in "Expert" (software) projects, not in "Vantage" (document/marketing) projects — format availability is split across the two product experiences rather than uniformly available.

## AI features

- "Lokalise AI" / AI orchestration layer: positioned as multi-LLM "smart routing" across providers rather than a single fixed model, plus built-in quality scoring and human-in-the-loop review.
- AI Translations: bulk AI-assisted translation tasks that automatically pull in project context — glossary, translation memory matches, style guide, task instructions — rather than translating strings in isolation.
- Custom AI Profiles: described as RAG-powered — retrieves relevant TM matches, glossary terms, style rules, and examples and injects them into the generation step per project/brand.
- AI LQA (AI Linguistic Quality Assurance): automated task type built on OpenAI's GPT API that scores/reviews existing translations against the DQF-MQM quality framework, flags glossary non-adherence, and returns categorized issues with suggested corrections — a QA/review layer on top of translations rather than a translation-generation feature itself.
- Two AI tiers metered separately in pricing: "Standard AI/MT" (described by third parties as basic engines — Google, DeepL, base ChatGPT — without context awareness) vs. "Pro AI" (context-aware, style-guide-driven, MQM scoring); Pro AI words/year are capped per plan and were historically a separate paid add-on (~$0.05/word) before being bundled into all tiers in the Nov 2025 restructure.
- Vendor claims "95% AI accuracy" — vendor-stated figure, not independently verified.

## Pricing

- Restructured November 2025: previous plans (Start $120/mo, Essential $230/mo, Pro $825/mo annual, plus a short-lived free-forever plan) were replaced by four tiers: Explorer, Growth, Advanced, Enterprise. The free-forever plan (introduced only months earlier in 2025) was withdrawn; a 14-day trial remains.
- As of 2026-07-06, self-serve list prices (monthly): Explorer $144/mo; Growth $375–499/mo (sources conflict — $499 at initial Nov 2025 launch, $375 as currently listed on lokalise.com/pricing at analysis time); Advanced $999/mo (requires a sales demo despite having a list price); Enterprise custom (requires a sales demo).
- Billing metric changed from seats + hosted keys to **processed words per year**, so heavy MT/AI usage now directly drives cost rather than being decoupled from translation volume. All paid tiers now include unlimited translation keys/hosted words; only "advanced" (non-basic) seats count against seat limits, basic translator/reviewer seats are unlimited.
- Approximate tier limits (base allowance / plan max, per vendor pricing page as fetched):
  - Explorer: 5 advanced seats (max 10); 10 target languages; 5 projects; 2 integrations; 60K processed words/yr (max 500K); 0 Pro AI words/yr included (max 100K); 25 automations; 10 GB OTA transfer.
  - Growth: 10 advanced seats (max 15); unlimited languages/projects; 3 integrations; 300K processed words/yr (max 1.5M); 50K Pro AI words/yr (max 250K); 50 automations; 50 GB OTA transfer.
  - Advanced: 15 advanced seats (max 40); unlimited languages/projects; 5 integrations; 1M processed words/yr (max 3M); 150K Pro AI words/yr (max 1M); 100 automations; 200 GB OTA transfer.
  - Enterprise: 40 advanced seats (max 100); unlimited integrations; 3M processed words/yr (max 15M); 400K Pro AI words/yr (max 2M); 150+ automations; 500 GB OTA transfer.
- All plans include: collaborative web editor, TM, glossary, in-context editors (web + mobile), custom-trigger automated workflows, analytics/audit logs, 2FA, SAML SSO, 24/7 support (per vendor page — contradicts third-party review claim that SSO/audit logging are gated to higher tiers; treat as a discrepancy between vendor's current page and older/independent commentary).
- Net effect of the restructure per third-party analysis (locize.com): entry-level list price rose roughly 20%, while the top self-serve price point dropped from $825 (old Pro, annual) to the $375–499 range — and 2 of 4 tiers now require a sales conversation instead of self-serve checkout, reducing pricing transparency for smaller teams.
- Cancellation terms: per G2 reviewer reports, Lokalise enforces a 90-day notice period to cancel (described by a reviewer as non-standard versus typical SaaS terms), and multiple reviewers report being billed again after believing they had cancelled — not independently verified beyond aggregated review text, but a recurring, specific complaint.

## Strengths

- Strong design-to-localization workflow: Figma/Adobe XD/Sketch plugins plus screenshot-based in-context editing are called out repeatedly as a genuine differentiator versus more code-only competitors.
- Broad, mature integration catalog (60+ claimed) spanning git hosts, PM tools (Jira), CMS (WordPress, Webflow, Contentful), and design tools.
- API v2 + `lokalise2` CLI give near-complete programmatic control over the platform (projects, keys, files, languages) suitable for CI/CD pipelines.
- OTA delivery + native SDKs (iOS/Android/Flutter) let mobile teams ship translation updates without app-store binary releases.
- AI feature depth is unusually granular for the category: separate Standard vs. Pro AI tiers, RAG-based Custom AI Profiles, and a dedicated AI LQA review task type (MQM-based) rather than just bulk MT.

## Weaknesses & criticism

(sourced from G2 reviews, third-party pricing analyses, and independent platform reviews — themes recurring across multiple sources)

- API rate limits reported as restrictive for CI/CD-heavy teams: 6 requests/second, 1 concurrent request per token cited by developers as a frequent source of 429 errors in automated pipelines (reported figure, not confirmed against an official current rate-limit doc page in this pass).
- 90-day cancellation notice period called out specifically by a G2 reviewer as non-standard vs. other SaaS vendors, with reports that Lokalise's sales team routed related pushback to their legal team; multiple reviewers report being billed after attempting to cancel.
- November 2025 pricing restructure raised entry-tier list price ~20%, removed the recently-introduced free plan, and moved 2 of 4 tiers behind mandatory sales demos — reducing self-serve transparency, per independent analysis (locize.com).
- Glossary functionality described by a G2 reviewer as "very limited" — no built-in check for whether a specific key actually used the correct glossary term in context (a gap AI LQA partially addresses but as a paid add-on capability, not core glossary tooling).
- Reviewer-reported reliability issue: marking an item as "reviewed" in the editor does not always persist.
- Per-seat cost scaling flagged by independent reviewer (better-i18n.com) as prohibitive for teams needing many non-engineer stakeholders (translators, PMs, reviewers) to have access, since only "basic" seats are unlimited — "advanced" seats (needed for many admin/workflow actions) are capped and priced per tier.
- Post-Semrush-acquisition (2024) uncertainty flagged by independent reviewers regarding pricing direction and product roadmap continuity; Semrush's own subsequent acquisition by Adobe (2026) adds a further layer of ownership change not yet reflected in most third-party commentary.
- Platform is UI-first by design; independent reviewers note it prioritizes the web editor over CLI-only workflows, which can feel like overhead for pure code-first/engineering teams that don't need the collaborative/workflow layer.

## What they do differently

- Two separate product experiences (Expert for software strings/repos/API, Vantage for marketing/document content) sharing one subscription and one usage pool (processed words, Pro AI words) — a segmentation model not present in simpler single-mode i18n tooling.
- Billing pegged to **processed words per year** (as of the Nov 2025 restructure) rather than to seats or hosted key counts — ties cost directly to translation/MT throughput, which can make AI-heavy workflows more expensive to forecast than a flat per-seat model.
- Two-tier AI system (Standard AI/MT vs. Pro AI) with separate metered annual word allowances per tier, plus a distinct RAG-based "Custom AI Profiles" capability — a more segmented/monetized AI feature ladder than a single "AI translate" button.
- Dedicated AI LQA task type scores existing translations against the DQF-MQM industry quality framework and returns categorized, correctable issues — a formal QA/scoring layer distinct from (and layered on top of) translation generation.
- Git-like in-product "branches" for isolating in-progress translation work, plus native OTA delivery + mobile SDKs — combines a git-workflow mental model with a runtime content-delivery model in one hosted product, rather than treating translation files purely as static build-time assets.
- Now sits inside the Adobe portfolio by way of two acquisitions (Semrush acquired Lokalise in 2024; Adobe acquired Semrush in 2026) — a corporate ownership chain that is unusual among standalone TMS competitors and worth monitoring for roadmap/pricing direction.
- Enforces an atypical 90-day cancellation notice period, a contractual term not commonly seen among comparable SaaS TMS vendors per reviewer complaints.

## Sources

- https://lokalise.com — accessed 2026-07-06
- https://lokalise.com/pricing/ — accessed 2026-07-06
- https://docs.lokalise.com/en/articles/11694835-new-price-plans-everything-you-should-know — accessed 2026-07-06
- https://docs.lokalise.com/en/articles/1400767-gettext-po-pot — accessed 2026-07-06 (via search snippet)
- https://docs.lokalise.com/en/articles/3229161-supported-file-formats — accessed 2026-07-06
- https://github.com/lokalise/lokalise-cli-2-go and associated docs (lokalise2_file.md, lokalise2_key.md) — accessed 2026-07-06 (via search snippet)
- https://www.g2.com/products/lokalise/reviews and https://www.g2.com/products/lokalise/pricing — accessed 2026-07-06 (via search snippet)
- https://www.locize.com/blog/phrase-lokalise-price-changes-2026 — accessed 2026-07-06
- https://better-i18n.com/en/blog/lokalise-platform-deep-review/ — accessed 2026-07-06
- https://slator.com/lokalise-raises-usd-50m-in-series-b/ and https://en.wikipedia.org/wiki/Lokalise — accessed 2026-07-06 (via search snippet, funding/founding history)
- Search results referencing Semrush's acquisition of Lokalise (2024) and Adobe's acquisition of Semrush (2026) — accessed 2026-07-06
- https://docs.lokalise.com/en/articles/14078087-lokalise-vantage-frequently-asked-questions (Vantage vs Expert distinction) — accessed 2026-07-06 (via search snippet)
- https://docs.lokalise.com/en/articles/1400492-uploading-translation-files — accessed 2026-07-06 (ICU verification)
- https://docs.lokalise.com/en/articles/1400503-plurals — accessed 2026-07-06 (ICU verification)
- https://docs.lokalise.com/en/articles/1400511-lokalise-universal-placeholders — accessed 2026-07-06 (ICU verification)
- https://lokalise.com/blog/complete-guide-to-icu-message-format/ — accessed 2026-07-06 (ICU verification, incl. documented limitations)
- https://developers.lokalise.com/reference/api-plurals-and-placeholders — accessed 2026-07-06 (ICU verification)
