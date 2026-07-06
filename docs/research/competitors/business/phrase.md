---
title: Phrase
category: tms
analyzed: 2026-07-06
analyzed_versions: "SaaS, feature state as of 2026-07-06"
homepage: https://phrase.com
repository: n/a (proprietary)
---

# Phrase

## Fact sheet

| Fact                | Value                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| Company / ownership | Phrase a.s. (PhraseApp + Memsource merger 2021); PE-owned (The Carlyle Group)                                  |
| License / model     | Proprietary SaaS suite (Strings, TMS, Studio, Language AI, Orchestrator)                                       |
| Pricing model       | Platform pricing: per-product seats + managed words + processed words/yr + MTUs/yr; $27–$1,245+/mo             |
| Adoption            | 4,500+ customers (2023 claim); ~400 employees; Forrester Wave Leader Q3 2025                                   |
| TMS vs. AI-first    | Enterprise TMS with heavy AI layer (Language AI: 30+ engines, QPS quality scoring)                             |
| Source of truth     | Hosted key/segment DB; files are import/export targets                                                         |
| Delivery            | File sync (CLI/git) + OTA                                                                                      |
| ICU MessageFormat   | Not explicitly verified in this analysis                                                                       |
| .po / gettext       | Yes — one among 50+ formats                                                                                    |
| Dev tooling         | phrase-cli (OSS), 8 REST API surfaces, git-host integrations, webhooks                                         |
| Self-hosting        | No                                                                                                             |
| Notable             | QPS: distilled AI model approximating MQM-2.0 human quality scores, gating review routing and MT training data |

## Snapshot

- Maintainer / company / funding: Phrase (Phrase a.s.), formed from the 2021 acquisition of Phrase (formerly PhraseApp, Hamburg-based) by Memsource, majority-owned by The Carlyle Group (Carlyle Europe Technology Partners IV invested in Memsource in July 2020). Company operates under the "Phrase" brand since a September 2022 rebrand unifying Memsource + PhraseApp into one platform. No independent public funding rounds beyond the Carlyle-backed acquisition; treat as PE-backed, not VC-funded in the startup sense.
- License / business model: proprietary closed-source SaaS "Language Intelligence Platform"; platform-based subscription pricing combining seats, managed/processed word volume, and machine-translation-unit (MTU) quotas across multiple bundled products (Strings, TMS, Studio, Language AI, Orchestrator, Analytics).
- Product state as of analysis date: mature, multi-product enterprise suite. Phrase Strings (software localization) and Phrase TMS (general enterprise TMS, ex-Memsource) are sold as separate-but-bundled products under one platform login; heavy 2025-2026 push into AI (Phrase Language AI, Quality Performance Score/QPS, Auto LQA, Custom AI, Auto Adapt). Named a Leader in the Forrester Wave Q3 2025 for translation management systems.
- Adoption signals: vendor-claimed customers include Uber, Zendesk, AWS, Snowflake, Deliveroo, Braze, Decathlon, PUMA, What3Words (marketing claims, not independently verified). Combined Memsource+Phrase customer base reported as 4,500+ as of July 2023 (not verified against a more current figure). ~400 employees as of March 2026 (not independently verified beyond aggregator estimate). G2 "Enterprise" and "Mid-Market" Leader badges claimed.
- Founded / age: Phrase (as PhraseApp) originated ~2011-2012 in Hamburg, Germany, demoed as a Ruby i18n in-place editor at Euruco 2012; evolved into "Phrase Translation Center" then "PhraseApp." Memsource (the acquiring/surviving corporate entity) was founded 2010 in Prague. Combined company is ~14-16 years old depending on which lineage is counted; exact founding year is not fully consistent across sources (2010, 2011, and 2012 all appear) — treat precise founding date as not verified.

## Positioning & target audience

- Markets itself as "the world's leading Language Intelligence Platform" — broader positioning than a developer-first i18n tool or even a single TMS; bundles software localization, general enterprise translation management, multimedia/video localization, and AI translation infrastructure under one umbrella.
- Explicitly targets five personas: localization managers, developers, technology/product teams, marketers, and executives — i.e., sells to localization ops and business stakeholders as much as engineering.
- Two historically distinct product lines still visible in the platform: Phrase Strings (ex-PhraseApp, developer/software-localization-first, key-based) and Phrase TMS (ex-Memsource, enterprise/LSP-style translation workflow for broader content types: docs, marketing, legal).
- Industry verticals emphasized: technology, retail, gaming, manufacturing, automotive, non-profits.
- Competes in the same "enterprise business TMS" category as Lokalise, Crowdin, Smartling, Transifex — not positioned as a lightweight or open-source i18n runtime library.

## Core concepts & architecture

- Strings vs. TMS split: Phrase Strings is optimized for products that manage text via keys across apps, websites, and games (developer-centric, continuous localization alongside product development); Phrase TMS is the general-purpose enterprise translation management system inherited from Memsource, oriented toward LSP-style multi-step workflows across broader content types (marketing, legal, docs), not just UI strings.
- Key-based string model in Strings: source content organized as keys/segments extracted from code repos or design files (e.g., Figma), rather than being purely file-diff-based.
- Branching: TMS/Strings support git-style "branches" so translation work on in-progress features can proceed in parallel without touching the main/production translation set, merged back when the feature ships.
- Translation Memory (TM): sentence/segment-level reuse store, assignable per project, shared across projects to reduce repeat translation cost.
- Glossary / Term Bases: concept-based terminology store (word/phrase-level, not full-segment) for enforcing consistent terminology; usable to help train custom MT models via Phrase Custom AI.
- Quality scoring: Phrase Quality Performance Score (QPS) — a 0-100 score blending Phrase's own AI evaluation, post-editing signal, and the industry-standard MQM 2.0 (Multidimensional Quality Metrics) framework; a smaller/faster AI model is trained to predict what an MQM human annotator would score, without producing a full manual annotation.
- Over-the-air (OTA) delivery: text/translation updates can ship to apps without being tied to a full app release cycle.

## Developer workflow & tooling

- CLI (`phrase-cli`, open-sourced at github.com/phrase/phrase-cli): cross-platform client exposing the full API surface; core commands are `push` (upload locale files via the uploads API, optionally overwriting existing translations with `update_translations`, async by default with a `--wait` flag) and `pull` (download locale files via the locales-download API).
- Configuration via a `.phrase.yml` file at the repo root, defining which files to import (pull) and export (push); all uploads-API and locales-download-API options are exposed as config keys.
- REST API: documented across eight separate references on the Phrase Developer Hub — Platform (unified auth), Strings, TMS, Language AI (MT/LLM aggregation, selection, quality assessment), Studio (audio/video, 100+ languages), Connectors (custom integration flow builder), Quality Evaluator, and Style Guides (org-wide writing guidelines, Markdown-based).
- GitHub/GitLab/Bitbucket integration: two-way sync of locale files against a monitored branch; lets localization managers trigger a release of new translations back to the dev team with one click, rather than developers manually pulling files.
- Webhooks for event-driven automation; 50+ third-party integrations claimed (Figma, Contentful, Slack, etc., in addition to git hosts).
- Native SDKs/mobile libraries and platform plugins exist (e.g., historical Xcode plugin) but a definitive, current SDK list was not found in the fetched developer-hub content — treat exact SDK/language coverage as not verified.

## Supported file formats

- 50+ file formats claimed by Phrase marketing.
- Confirmed formats: JSON (including i18next and i18n-node-2 JSON dialects), YAML, XML, Android XML strings, Apple .strings and .xcstrings, Flutter ARB, CSV, gettext .po/.pot, XLIFF (versions 1.2, 2.0, 2.1, 2.2).
- .po/gettext is supported as one format among many, not treated as the canonical/only source-of-truth format — Phrase's own hosted key/segment database is the system of record, with file formats as import/export targets (same architecture pattern as other hosted TMS competitors, e.g. Crowdin).

## AI features

- Phrase Language AI: aggregates 30+ MT engines plus LLM-based translation; positioned as an MT/LLM "aggregation and selection" layer (auto-routing content to the best-performing engine per content type/language pair) rather than a single fixed model.
- Phrase QPS (Quality Performance Score): 0-100 score combining proprietary AI evaluation, post-edit signal, and MQM 2.0; available across Phrase TMS, Phrase Strings, and via the Language AI API. Used to set quality thresholds that automatically route low-scoring segments to human post-editing while high-scoring segments skip further review ("hyperautomation" framing in Phrase's own materials).
- Auto LQA: automated linguistic quality assurance tied to the QPS scoring pipeline.
- Phrase Custom AI: lets customers train/fine-tune custom MT models using their own TM/glossary data; QPS is used to filter which TM segments are "good enough" to serve as training data.
- Phrase Auto Adapt: described by Phrase as a quality-optimization tool (exact mechanism not independently verified beyond vendor naming/description).
- Phrase Quality Evaluator (API): a separate documented API for AI-powered translation-quality checks.
- Style Guides: org-wide writing/style guideline management (Markdown-based) that AI features can reportedly draw on for tone/terminology consistency — exact integration depth not verified.

## Pricing

(as published on phrase.com/pricing, accessed 2026-07-06; all figures are list/vendor-published, annual billing unless noted)

- Freelancer: $27/month — 1 TMS seat only, 200K managed words, 650K processed words/year.
- Software UI/UX: $525/month — 15 Strings seats, unlimited TMS, 1M managed words, 500K processed words/year, 1M MTUs/year; 14-day free trial.
- Professional: $525/month — unlimited TMS, 150 Strings seats, 300K managed words, 4M processed words/year.
- Team: $1,245/month — unlimited TMS seats, 20 Strings seats, 1.2M managed words, 2.5M processed words/year, 12M MTUs/year; "all Phrase products included."
- Business: custom/contact-sales — unlimited TMS, 150 Strings seats, 3M managed words, 12M processed words/year, 50M MTUs/year; custom metadata, unlimited MT profiles.
- Enterprise: custom/contact-sales — unlimited TMS, 150+ Strings seats, fully customizable capacity, premium support, tailored onboarding, dedicated private communication channel.
- Model: platform-based pricing combining (a) per-product seat counts (TMS seats vs. Strings seats are counted/priced separately), (b) managed-word and processed-word-per-year volume caps, and (c) machine-translation-unit (MTU) quotas per year — not a simple flat per-seat SaaS price. Capacity add-ons (extra seats, words, MTUs, workflows, portal users) are sold on top of base tiers.
- G2/user reports describe recent "significant price increases" and bundling of additional products (Studio, Orchestrator, etc.) that some customers say they don't need or want — see Weaknesses.

## Strengths

- Single platform spanning software strings (Strings), general enterprise TMS, multimedia/video localization (Studio), and AI infrastructure (Language AI) — fewer vendor integrations needed for orgs wanting one contract covering all localization content types.
- QPS gives a standardized, MQM-2.0-anchored numeric quality score usable to gate human review automatically — a more formal quality-automation layer than most competitors expose.
- Broad MT/LLM engine aggregation (30+ engines) with engine-selection/auto-routing rather than lock-in to a single MT provider.
- Mature CLI/API and native git-host integrations suitable for CI/CD-driven continuous localization.
- Custom AI model training on customer-owned TM/glossary data, filtered by QPS quality threshold — a differentiated data-quality control most smaller competitors don't publicize.
- Forrester Wave Q3 2025 Leader and G2 Enterprise/Mid-Market Leader recognition (vendor-reported).

## Weaknesses & criticism

(themes recurring in G2 reviews and industry coverage; specific reviewer counts/dates not individually re-verified in this pass)

- Recent price increases are a recurring complaint; reviewers describe the company adding multiple new products (Studio, Orchestrator, Analytics, etc.) to plans that customers feel obligated to pay for without wanting to use them.
- Support/commercial friction: some users report Phrase's commercial support was unwilling to cancel automatic rebills or negotiate pricing after dissatisfaction with increases, with users describing the experience as feeling "scammed" (G2-sourced theme).
- Terminology/glossary matching is reported as rigid — Phrase reportedly does not recognize conjugated/inflected forms of a glossary term, flagging grammatically-correct variants as "not using the term."
- Two historically separate products (Strings from PhraseApp, TMS from Memsource) still visible as somewhat distinct systems under one login — reviewers and integration docs treat "Strings" and "TMS" as parallel products with separate seat pools rather than one unified data model.
- Pricing model complexity: multiple simultaneously-metered dimensions (seats split by product, managed words, processed words/year, MTUs/year) make cost forecasting harder than flat per-seat or per-word pricing.
- As a proprietary hosted SaaS, no self-hosted/on-prem option; data residency/vendor lock-in concerns apply as with other hosted TMS competitors.

## What they do differently

- Broadest product bundling in the category: one vendor covers software strings (Strings), enterprise TMS (ex-Memsource), video/audio localization (Studio), MT/LLM aggregation (Language AI), custom AI model training (Custom AI), and workflow automation (Orchestrator) — most competitors specialize in a subset of this.
- QPS is a genuinely distinctive AI feature: a fast, distilled AI model trained to approximate MQM-2.0 human-annotator quality scores (0-100) in real time, used both for routing translations to post-editing and for filtering which TM data is "clean enough" to train Custom AI models — a quality-gated feedback loop between human review, MT training data, and automation thresholds.
- MTUs (machine-translation-units) are a first-class billable/capacity unit alongside seats and word counts — a metering dimension specific to Phrase's MT-heavy pricing model, not commonly seen as an explicit unit in competitor pricing pages.
- Auto LQA + Custom AI + QPS form a closed loop: quality scoring feeds both review-routing decisions and MT model retraining, which is a more automation-forward architecture than the "AI pre-translation as an assistive first pass" model used by competitors like Crowdin.
- Retains a visible product-line seam from its 2021 merger (Strings vs. TMS as semi-parallel products with separate seat pools) rather than presenting a single unified translation data model — a structural artifact of the PhraseApp+Memsource merger still evident in 2026 pricing and docs.
- PE-backed (Carlyle) ownership rather than VC-funded-startup or founder-owned/bootstrapped — different growth/pricing incentives than several competitors in the space.

## Sources

- https://phrase.com — accessed 2026-07-06
- https://phrase.com/pricing/ — accessed 2026-07-06
- https://phrase.com/platform/ai-solutions/quality-performance-score/ — accessed 2026-07-06
- https://developers.phrase.com/en/ — accessed 2026-07-06
- https://support.phrase.com/hc/en-us/articles/5808300599068-Using-the-CLI-Strings — accessed 2026-07-06 (via search)
- https://github.com/phrase/phrase-cli — accessed 2026-07-06 (via search)
- https://support.phrase.com/hc/en-us/articles/6111343649820--PO-gettext-files-Strings — accessed 2026-07-06 (via search)
- https://en.wikipedia.org/wiki/PhraseApp — accessed 2026-07-06
- https://www.carlyle.com/media-room/news-release-archive/memsource-acquires-phrase — accessed 2026-07-06 (via search)
- https://slator.com/memsource-ceo-david-canek-on-the-acquisition-and-integration-of-phrase/ — accessed 2026-07-06 (via search)
- https://www.whitecase.com/news/press-release/white-case-advises-memsource-and-carlyle-group-acquisition-majority-stake-phrase — accessed 2026-07-06 (via search)
- https://phrase.com/blog/posts/phrase-part-of-memsource-group/ — accessed 2026-07-06 (via search)
- https://slator.com/phrase-unveils-quality-performance-scoring-unlock-power-of-ai-localization-automation/ — accessed 2026-07-06 (via search)
- https://support.phrase.com/hc/en-us/articles/5709672289180-Phrase-QPS-Overview — accessed 2026-07-06 (via search)
- https://www.g2.com/products/phrase-localization-platform/reviews — attempted 2026-07-06, blocked (HTTP 403); themes sourced via search-result summaries of G2 content instead
- General web search results on Phrase company history, employee count, customer base, and file-format support — accessed 2026-07-06
