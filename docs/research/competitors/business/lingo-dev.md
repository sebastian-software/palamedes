---
title: Lingo.dev
category: hybrid
analyzed: 2026-07-26
analyzed_versions: "lingo.dev CLI 0.138.3 (npm, published 2026-07-24); repo lingodotdev/lingo.dev state 2026-07-26; platform pricing as reported by third-party aggregators 2026-07-26"
homepage: https://lingo.dev
repository: https://github.com/lingodotdev/lingo.dev
---

# Lingo.dev

> Formerly **Replexica**. Filed under `business/` because the revenue product is a
> hosted localization platform, but the open-source tooling is substantial enough
> that it competes with library-layer projects too.
>
> **Strategic note — this is the closest analogue to Palamedes Plus.** Open tooling
> under a permissive licence, a commercial layer above it, the repository staying
> authoritative, delivery through CLI and CI rather than a dashboard, and a pull
> request as the artifact. That is the same shape ADR-018 describes. They are
> therefore a partner to the open-source core (PO on both sides) **and** a
> competitor to the commercial tier, and the second half is what matters for
> planning. Keep them out of public marketing surfaces: naming them on the website
> would build up a future Plus competitor at our own expense. The `/compare` hub
> makes the architectural point about CI translation steps generically and does
> not name any vendor — keep it that way.

## Fact sheet

| Fact                | Value                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| Company / ownership | Lingo.dev (`lingodotdev`); funding not verified in this pass                                                  |
| License / model     | Apache-2.0 tooling (CLI, Action, Compiler) + closed hosted platform                                           |
| Pricing model       | Per translated word/month. Hobby free (10k words), Pro $30/mo (20k), Team $600/mo (100k) — aggregator-sourced |
| Adoption            | ~69.2k npm downloads/week (`lingo.dev`); 5.4k GitHub stars, 819 forks, 36 open issues                         |
| TMS vs. AI-first    | AI-first — an "AI Localization Engine", with a web editor on higher tiers                                     |
| Source of truth     | Your repository files — the CLI reads and writes them in place                                                |
| Delivery            | Files committed back to your repo via CLI/CI; platform API optional                                           |
| ICU MessageFormat   | Not the product's concern — it translates files, preserving whatever format they are in                       |
| .po / gettext       | **Yes** — PO is a supported CLI format alongside JSON, YAML, Markdown, CSV                                    |
| Dev tooling         | CLI, GitHub Action, React MCP server, Compiler for React (early alpha), API                                   |
| Self-hosting        | Tooling runs locally with your own LLM keys; the platform engine is hosted                                    |
| Notable             | Names its model providers explicitly (OpenAI, Anthropic, Google, Mistral, OpenRouter, **Ollama**)             |

## Snapshot

- Maintainer / company: Lingo.dev, GitHub organisation `lingodotdev`. Previously known as Replexica. Funding, headcount and legal entity were **not verified** in this pass.
- First release / age: npm package `lingo.dev` created 2025-01-17; roughly 1.5 years old as of 2026-07-26, with **342 published versions** — extremely high release velocity.
- Current version: 0.138.3, published 2026-07-24 (two days before this analysis). Still on a `0.x` line.
- Adoption: ~69.2k weekly downloads (registry search API, 2026-07-26); 5.4k GitHub stars, 819 forks, 36 open issues — the highest star count of any project in this research set apart from the long-established incumbents.
- License: Apache-2.0 for the open-source tooling — a real OSI licence, in explicit contrast to General Translation's FSL-1.1-ALv2.

## Positioning & target audience

- Positions as "open-source localization engineering tools" that connect to the "Lingo.dev localization engineering platform for consistent, quality translations."
- Targets engineering teams that want continuous localization wired into CI rather than a translation-management UI for localization managers — the primary artifact is a pull request, not a dashboard.
- Competes with General Translation most directly (AI-first, developer-first, vertically integrated), and with the CLI layer of TMS vendors like Crowdin and Phrase.

## Core concepts & architecture

- The product is a **pipeline, not a runtime**. The CLI reads your existing localization files, sends source content to a model, and writes translated files back. There is no i18n runtime library to adopt and no message identity model imposed — you keep whatever i18n library you already use.
- Supported CLI formats: JSON, YAML, Markdown, CSV and **PO**.
- **Compiler for React** is a separate, early-alpha component that performs build-time localization "without i18n wrappers" — the only part of the product that overlaps with what Palamedes, Lingui or Paraglide do. Treat it as pre-production.
- **React MCP server** provides AI-assisted i18n setup for React apps — an agent-facing surface rather than a runtime.
- GitHub Action wires the CLI into CI for continuous localization on every commit.

## Framework & platform support

- Because it operates on files rather than at runtime, it is framework-agnostic by construction — anything that stores messages in JSON, YAML, Markdown, CSV or PO is in scope.
- The React Compiler is the only framework-specific piece, and it is early alpha.

## Catalog formats & interop

- PO support is first-class in the CLI, which makes Lingo.dev **directly composable with Palamedes** rather than competitive with it: Palamedes writes `.po` from source, Lingo.dev can translate those files in CI, and the result is committed back to the repository.
- Because files stay in the repository and are edited in place, the source of truth remains git — architecturally the same stance Palamedes and Weblate take, and the opposite of hosted-database TMS products.

## Workflow & tooling

- Local CLI run, or GitHub Action for continuous localization on commit.
- Web editor is listed as a Team-tier feature.
- Glossaries and brand-voice/context settings feed the translation engine.

## AI features

- The AI translation engine is the product. Unusually, the model providers are **named and pluggable**: package dependencies confirm `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google` and `@ai-sdk/mistral`, and the README additionally lists OpenRouter and **Ollama**.
- Ollama support implies the CLI can run against a fully local model with no vendor API call — a materially different privacy and cost position from vendors whose production models are undisclosed.
- Whether the free/paid platform tiers require routing through Lingo.dev's own engine (rather than your own keys) was **not verified**; the README's framing suggests both paths exist.

## Pricing

- Reported tiers (from third-party aggregators — the primary pricing page returned HTTP 403 to automated fetching, so treat these as **directional and unverified**):
  - Hobby: free, 10,000 translated words/month, unlimited glossaries and languages, CI/CD integrations, single project.
  - Pro: $30/month, 20,000 words/month, $2.50 per additional 1,000 words.
  - Team: $600/month, 100,000 words/month, $0.25 per additional 1,000 words, unlimited projects, web editor, private Slack.
- Marketing claims 83 supported languages.

## Strengths

- Apache-2.0 on the tooling — genuinely open source, in contrast to the source-available licensing General Translation uses for the same category of product.
- Names its model providers and supports bring-your-own-key including a fully local option via Ollama, which is the most transparent AI position in this research set.
- Files stay in the repository. The CLI edits in place and commits back, so git remains the system of record — no hosted key database to migrate out of later.
- PO is a first-class CLI format, so it composes with gettext-based toolchains instead of requiring conversion.
- Library-agnostic: you keep your existing i18n runtime, which makes adoption and removal both cheap.
- Very active development (342 versions in ~1.5 years) and the strongest community signal of the newer entrants (5.4k stars).

## Weaknesses & criticism

- Still `0.x` after 342 releases, with a release cadence fast enough that pinning versions in CI is advisable.
- The React Compiler — the only piece that overlaps with compile-time i18n libraries — is explicitly early alpha and should not be evaluated as a shipping alternative to Palamedes, Lingui or Paraglide.
- No message identity, extraction, catalog audit or ICU validation layer: the tool assumes something else already produced well-formed catalogs. It is downstream of the problem Palamedes solves, not a substitute for it.
- Pricing could not be verified against the primary source in this pass; all tier figures here are aggregator-sourced.
- Company details — funding, headcount, entity — were not verified. As with any ~1.5-year-old vendor holding a step in your release pipeline, that is worth confirming directly before depending on the hosted engine.
- No independent critical commentary or post-mortems were found in this pass; assess as an early-stage product with limited external scrutiny.

## What they do differently

- **A pipeline, not a runtime.** Almost every other product in this research set asks you to adopt its library. Lingo.dev asks you to keep yours and hands you a translation step for CI.
- **Named, pluggable, optionally local models.** Publishing the provider list and supporting Ollama inverts the usual AI-vendor posture, where the production model is undisclosed.
- **Repository stays authoritative.** Files are edited in place and committed back, so the tool never becomes the system of record — closer to Weblate's philosophy than to Crowdin's.
- **Agent-facing surface as a first-class product** (React MCP server), aimed at AI coding agents performing i18n work rather than at humans in a dashboard.
- **Composes with the Palamedes open-source core rather than replacing it**, because PO is a supported format on both sides — while competing directly with the planned commercial tier. Partner below the line, competitor above it; see the strategic note at the top.

## Sources

- https://registry.npmjs.org/lingo.dev (live API, accessed 2026-07-26)
- https://registry.npmjs.org/-/v1/search?text=lingo.dev (download counts, live API, accessed 2026-07-26)
- https://github.com/lingodotdev/lingo.dev (README and repository metadata, accessed 2026-07-26)
- https://www.saasworthy.com/product/lingo-dev/pricing (aggregator, low-confidence, accessed 2026-07-26)
- https://aichief.com/ai-development-tools/lingo-dev/ (aggregator, low-confidence, accessed 2026-07-26)
- https://lingo.dev/en/pricing (primary pricing page — returned HTTP 403 to automated fetching, accessed 2026-07-26)
