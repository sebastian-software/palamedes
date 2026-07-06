---
title: Crowdin
category: tms
analyzed: 2026-07-06
analyzed_versions: "SaaS, feature state as of 2026-07-06"
homepage: https://crowdin.com
repository: n/a (proprietary; OSS tooling under github.com/crowdin)
---

# Crowdin

## Snapshot

- Maintainer / company / funding: Crowdin (legal entity: Crowdin OÜ), headquartered in Tallinn, Estonia. Reported as bootstrapped, no VC funding found in public records (Crunchbase/PitchBook-derived secondary sources) — not fully verified against a primary filing.
- License / business model: proprietary closed-source SaaS TMS; freemium — free for open-source/academic/non-commercial use, paid tiers for commercial use, priced on "hosted words" volume + seats/private projects.
- Product state as of analysis date: mature TMS with AI pre-translation, AI QA, an "AI project orchestrator" (Crowdin Copilot), and an actively maintained MCP (Model Context Protocol) server (v2, with v1 deprecated) supporting Claude Desktop, Claude Code, Cursor, VS Code, Windsurf as clients.
- Adoption: homepage claims "700+ apps and integrations," "100+ file formats," 708 verified G2 reviews; docs page separately states "50 Supported Formats"; third-party review site states "40+ file formats" — these three figures are unreconciled. User-account claims range from ~500K to 3M+ depending on source (Tracxn vs. other secondary sources) — not verified which is current. Named customers: Strava, GitHub, GitLab, Cal.com, Pipedrive, Wildlife Studios, Linearity (homepage); Xiaomi (Crowdin blog, Enterprise case); Minecraft, VS Code, Django, Electron use the platform via open-source/free tier (Wikipedia/third-party, not necessarily paid enterprise customers).
- Founded / age: 2009 (some secondary sources say 2008), by Ukrainian programmer Serhiy Dmytryshyn, originally a hobby project — ~17 years old as of 2026. Employee count estimated ~120-130 (range 25-250 across secondary sources, inconsistent). Reported revenue ~$13.2M (single third-party source, getlatka.com — not corroborated).

## Positioning & target audience

- Markets itself as an "AI-powered localization platform," not a developer-first i18n library — a business TMS competing with Lokalise, Phrase, Transifex, Smartling.
- Two product lines: **Crowdin** (self-serve, for teams of 2-100) and **Crowdin Enterprise** (large orgs, custom pricing, annual billing only, SSO/custom roles/audit logs).
- Primary users are localization managers, translators/proofreaders, and PMs as much as engineers — the web UI is the primary interface, not a CLI-first workflow.
- Built-in translation vendor marketplace: customers can hire professional translation agencies/freelancers directly inside the product (B2B2B marketplace model).
- Serves both commercial enterprises and open-source/academic projects (free tier/license for the latter).

## Core concepts & architecture

- "Hosted words" is the core pricing/consumption unit: (words needing translation) × (number of target languages) — a 1,000-word file translated into 5 languages consumes 5,000 hosted words.
- Storage-based API model: files (source, screenshots, glossaries, TMs) are uploaded to a "Storage" endpoint first, receive a storage ID, then get attached to a project — a two-step indirection not present in simpler file-sync tools.
- Long-running operations (report generation, project builds, downloads) are async with polling, reflecting a server-hosted-state architecture rather than a stateless file transform.
- Branching: projects support branches mirroring git branches, letting teams do parallel translation work aligned to feature branches before merging back.
- Context for translators: in-context screenshots, string/file-level comments, "Context Harvester CLI" (extracts context from source code), and a "Website Context Extractor" (AI agent that crawls a live website to auto-detect string context).
- Translation Memory (TM) and Glossary are project/org-wide resources reused across projects; a "Vector Cloud" feature uses TM + glossaries + reference files for AI-quality improvement (implying embedding/vector retrieval over TM data).
- Configurable multi-step workflows (translate → proofread → approve) with role-based permissions and vendor/task assignment — a heavier process model than a source-string-first .po workflow.

## Developer workflow & tooling

- **CLI** (Java-based, requires Java 17+, cross-platform): commands include `init` (interactive config generation), `upload`, `download`, `status`, `pre-translate`, plus subcommand families for `branch`, `string`, `bundle`, `glossary`, `tm`, `context`, `task`, `project`, `label`, `distribution`. Config lives in `crowdin.yml`; CLI flags override file config; supports multithreaded uploads.
- **REST API v2**: separate file-based and string-based reference docs, plus a distinct Enterprise API reference. Official client libraries: JavaScript, PHP, Java, Python, Ruby, .NET, Go. No rate-limit figures found in fetched docs — not verified.
- **GitHub/GitLab/Bitbucket/Azure DevOps sync**: two options — a no-code native GitHub integration configured in the Crowdin UI, or the official GitHub Action for scriptable CI/CD use. Sync model: translated/approved content is merged into an auto-generated `l10n` (or `l10n_<branch>`) service branch, which becomes a PR; source-file changes sync independently/continuously from the translation-download schedule. A community forum thread ("GitHub integration won't sync") suggests sync reliability is a recurring support topic — not independently confirmed in depth.
- **MCP (Model Context Protocol) server** — a real, actively maintained capability, not just an announcement:
  - Endpoints: `https://mcp.crowdin.com/v2/mcp` (Crowdin), `https://{org}.mcp.crowdin.com/v2/mcp` (Enterprise).
  - Tool categories: Core Localization & Content (files, strings, glossaries, TMs, screenshots, labels); Project Operations (tasks, reports, distributions, bundles, webhooks); AI & Automation (AI prompts, MT config, QA checks); People & Organization (users, teams, clients, vendors, security logs — Enterprise-only subset).
  - Read-only `crowdin://` URI resource scheme for quick context lookup (projects, files, tasks, glossaries, TMs, languages).
  - Configurable via headers (`crowdin-tool-sets`, `crowdin-read-only`, `crowdin-project-type`, `crowdin-tool-filter`); auth via OAuth, Personal Access Token, or OAuth Apps.
  - Explicitly supported/tested clients: Crowdin Copilot (native), **Claude Desktop**, **Claude Code**, Cursor, VS Code, Windsurf.
  - V2 is current/recommended; V1 marked deprecated — indicates ongoing iteration since a 2025 rollout (referenced in Crowdin's July 2025 changelog and an MCP explainer blog post).
- OTA content delivery + CDN: translations can be fetched at runtime without redeploying app binaries; CDN add-on is free up to 1M requests / 10GB data transfer per month, paid beyond that (overage price not found).
- Mobile SDKs (iOS, Android, Flutter) for pulling published translations at runtime.

## Supported file formats

- Docs page states **"50 Supported Formats"**; homepage separately claims **"100+ file formats"**; a third-party review site states **"40+ file formats"** — three inconsistent figures, not reconciled, treat as vendor/secondary marketing claims rather than a single verified count.
- Confirmed named formats (via search-indexed docs content, not a fully rendered live table): Android XML, macOS/iOS `.strings` and `.stringsdict`, JSON (plain, Chrome JSON, Go JSON, **i18next JSON** explicitly named, FBT JSON, RES JSON), **XLIFF and XLIFF 2.0**, Java `.properties` (plus Play Properties, Java Properties XML), **RESX/RESW** (.NET), **YAML**, INI (plus Joomla INI), JS/FJS, **PO (gettext)**, Qt `.ts`, TOML, CoffeeScript, XAML, subtitle formats (SRT, VTT, VTT2, SBV), SVG, DTD, CSV, RC, WXL, Haml, XLSX, PLIST, PHP arrays, **ARB** (Flutter/Dart), VDF.
- .po/gettext is explicitly supported and listed as a first-class format alongside JSON/XLIFF.
- Generic "nested vs. flat JSON" distinction is not explicitly documented in available sources — likely handled by one of the specific JSON format variants, but not verified.
- Auto-conversion on import (confirmed via direct docs fetch): DOC→DOCX, PPT→PPTX, RTF→DOCX, PDF→DOCX; non-text "asset" formats also accepted: `.psd`, `.ai`, `.png`, `.jpeg`.

## AI features

- **Models/providers**: page states "10+ providers / dozens of AI translation models" plus support for "custom AI modules" — no specific provider (OpenAI/Anthropic/Google) is named on the AI-translation feature page. Exact model roster not verified.
- **AI pre-translation**: generates draft translations intended to match project style/terminology; supports cross-language references and API-key-based data protection.
- **AI Pipeline**: breaks large translation jobs into smaller steps with automatic inter-step checking, aimed at reducing AI error propagation.
- **Context-awareness** (four distinct mechanisms):
  1. Visual Understanding — AI reads UI screenshots to infer meaning and detect UI element types (buttons, headings, menus).
  2. Context Harvester CLI — extracts context directly from source code.
  3. Website Context Extractor — an AI agent that crawls a live website to auto-extract string context.
  4. Vector Cloud — uses TM, glossaries, and reference files (implies vector/embedding-based retrieval) to improve translation accuracy.
- **AI agents**: **Crowdin Copilot**, described as an "AI project orchestrator" that automates task creation, file organization, and workspace management via natural-language commands; it is also the native client for the MCP server.
- **MCP support**: confirmed, see Developer workflow section — a genuine, actively maintained integration (v2 current, v1 deprecated), not just a marketing mention. Not surfaced on the AI-translation marketing page itself; documented separately under developer docs.
- **AI QA/proofreading**:
  - AI QA Check — spelling, grammar, terminology, formatting validation.
  - AI Proofreader — real-time feedback on clarity, grammar, terminology.
  - AI Debug — lets users inspect/troubleshoot AI translation decisions (an explainability layer).
- **AI pricing**: no AI-specific price or credit system disclosed on the AI-translation page. The pricing page lists AI translation under "Managed Services" (alongside machine translation and professional translation services) without a stated price. Whether AI usage draws from hosted-word allowance or a separate quota — not verified.

## Pricing

(figures cross-referenced from crowdin.com/pricing — table is JS-rendered and did not fully capture via direct fetch — corroborated by third-party aggregators costbench.com and G2's pricing summary; treat as third-party-corroborated, not a first-party screenshot)

| Plan               | Price/month                                 | Hosted words | Private projects | Notes                                                                                                                          |
| ------------------ | ------------------------------------------- | ------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Free               | $0                                          | 60,000       | 1                | Unlimited translators on public projects; separate free Open Source and Academic licenses (unlimited projects/strings/members) |
| Pro                | $59                                         | 60,000       | 2                | Entry paid tier, "small teams starting with localization"                                                                      |
| Team               | $179                                        | 100,000      | Unlimited        | "Growing product teams"; used for the 14-day free trial                                                                        |
| Team+              | $450                                        | 500,000      | Unlimited        | "Large organizations managing multiple products"                                                                               |
| Business           | Custom (contact sales)                      | Custom       | Custom           | 30-day trial includes "all Business plan features"                                                                             |
| Crowdin Enterprise | Custom (contact sales), annual billing only | Custom       | Custom           | Separate product line; adds SSO, custom roles, advanced workflows, audit logs (per third-party review)                         |

- Annual billing: "2 months FREE" (~16.7% discount vs. monthly).
- Unlimited translators/proofreaders on all paid plans.
- CDN for Translations add-on: free up to 1M requests/10GB transfer per month; overage price not disclosed.
- Managed Services add-on (MT, AI content generation, professional translation) priced on request, no published rate.

## Strengths

- Broad file-format coverage spanning modern JS/web formats (JSON variants, YAML, PO) and legacy enterprise formats (RESX, Java properties, Qt .ts) in one platform.
- Genuinely mature MCP server (v2) with explicit support for Claude Code/Claude Desktop/Cursor/VS Code/Windsurf — ahead of most TMS competitors in agentic-tooling integration as of mid-2026.
- Long track record (since 2009) and large third-party integration marketplace.
- Context-harvesting tooling (screenshots, source-code extraction, live-website crawling) goes beyond simple TM/glossary matching.
- CI/CD-friendly sync via CLI/GitHub Action with branch-aware translation workflows.
- Unlimited translators/proofreaders even on paid self-serve tiers, useful for community/vendor-heavy projects.

## Weaknesses & criticism

(sourced from Capterra direct reviews, G2 review summaries via search, and a third-party deep-review site; Reddit/HN discussion specifically about Crowdin could not be located via search — any such claim should be treated as unsourced)

- Pricing: Capterra reviewer quote — "The pricing for organizations is pretty high, it can be unreasonably expensive for small companies." G2 review summaries similarly flag affordability concerns for small businesses, indie developers, and freelancers, calling paid tiers "steep for limited or infrequent use." (Capterra: capterra.com/p/163509/Crowdin/reviews/; G2 summary via search)
- UI/UX: Capterra quote — "I don't find the user interface very intuitive. I often have to read an article or google something to find it." G2 summaries describe the UI as "overwhelming for newcomers" and "less intuitive for non-technical users and external collaborators."
- AI skepticism from users: one Capterra reviewer explicitly called out "AI translations (that never work)" and described features like "Context pages" as unnecessary for their use case.
- Feature-gating: some features (e.g., style guidelines, SSO, custom roles, advanced workflows, audit logs) are locked behind higher/Enterprise tiers, creating cost step-ups as teams grow (better-i18n.com deep review).
- Performance at scale: Capterra reviewers note "occasional performance issues with larger projects" and slow loading when viewing multiple languages simultaneously; better-i18n.com cites unnamed community-forum reports of "slower editor performance and extended sync times" for projects with 100,000+ strings (not independently verified further).
- Setup complexity: better-i18n.com review states branching strategies, custom file processing, and automated QA pipelines "require significant configuration and technical knowledge"; Capterra reviewers describe GitHub sync as complex to set up initially.
- Workflow quality control: Capterra reviewer notes inexperienced/crowd translators can flood the editor with poor-quality suggestions, forcing proofreaders into repeated cleanup.
- Support: G2 summaries mention "slower fixes, uneven feature knowledge, and occasional frustration" requiring repeated contact for complex issues.
- As a proprietary hosted SaaS, no self-hosted/on-prem option — a recurring concern for data-residency-sensitive organizations (general TMS-category pattern, not a Crowdin-specific quote).

## What they do differently

- Actively maintained MCP server (v2) with first-class support for Claude Code and Claude Desktop as clients — Crowdin is notably ahead of typical TMS competitors in agentic/AI-tool integration as of mid-2026, not just AI-translation-as-a-feature but AI-agent-as-a-client-of-the-TMS.
- "Hosted words" pricing unit multiplies source words by target-language count — a volume metric that scales cost with fan-out to more languages, differing from simple per-string or flat-seat pricing models.
- Server-hosted, storage-then-attach API architecture (upload to Storage, get an ID, attach to project) — the authoritative translation state lives in Crowdin's hosted project, with git/source files as a sync target rather than the source of truth, the inverse of a source-string-first, file-based .po workflow.
- Context-harvesting goes beyond static screenshots: a "Website Context Extractor" AI agent crawls a live website to auto-detect string context, and a source-code-aware "Context Harvester CLI" extracts context directly from code.
- Built-in two-sided translation vendor marketplace lets customers hire professional agencies/freelancers directly inside the product.
- Git-branch-aware translation branches mirror source-control branching inside the TMS itself, a workflow concept largely absent from simpler file-sync-only i18n tools.
- "AI Debug" feature offers explainability/troubleshooting over AI translation decisions — an unusual transparency layer for MT/AI output.
- Two distinct product lines (self-serve Crowdin vs. Crowdin Enterprise, annual-billing-only) rather than a single scaling tier ladder — the Enterprise line gates SSO, custom roles, and audit logs entirely off the self-serve path.

## Sources

- https://crowdin.com — accessed 2026-07-06
- https://crowdin.com/features/ai-translation — accessed 2026-07-06
- https://crowdin.com/pricing — accessed 2026-07-06
- https://crowdin.com/blog/what-is-a-model-context-protocol — accessed 2026-07-06
- https://crowdin.com/blog/whats-new-at-crowdin-july-2025 — accessed 2026-07-06
- https://support.crowdin.com/supported-formats/ — accessed 2026-07-06
- https://support.crowdin.com/developer/crowdin-mcp-server/ — accessed 2026-07-06
- https://support.crowdin.com/github-integration/ — accessed 2026-07-06
- https://support.crowdin.com/developer/api/v2/ — accessed 2026-07-06
- https://crowdin.github.io/crowdin-cli/ — accessed 2026-07-06
- https://github.com/crowdin/github-action — accessed 2026-07-06
- https://en.wikipedia.org/wiki/Crowdin — accessed 2026-07-06
- https://www.capterra.com/p/163509/Crowdin/reviews/ — accessed 2026-07-06 (177 verified reviews, 4.7/5 overall at time of access)
- https://www.g2.com/products/crowdin/reviews — direct fetch blocked (HTTP 403); used via search-engine result synthesis only, accessed 2026-07-06
- https://better-i18n.com/en/blog/crowdin-platform-deep-review/ — accessed 2026-07-06
- https://costbench.com/software/localization/crowdin/ — accessed 2026-07-06
- https://leadiq.com/c/crowdin/5a1da446230000590096b63a — accessed 2026-07-06
- https://tracxn.com/d/companies/crowdin/__zUQRSsPMq2Bm7z6avMCext5orGAXO9eeq2NP-0tJQ0s — accessed 2026-07-06
- https://getlatka.com/companies/crowdin.com — accessed 2026-07-06 (revenue figure, single source, not corroborated)
- https://community.crowdin.com/t/github-integration-wont-sync/16433 — noted via search, not fetched in depth
