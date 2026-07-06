---
title: Weblate
category: tms
analyzed: 2026-07-06
analyzed_versions: "2026.7 (released 2026-07-01)"
homepage: https://weblate.org
repository: https://github.com/WeblateOrg/weblate
---

# Weblate

## Snapshot
- Maintainer / company / funding: Weblate s.r.o. (registered in Cvikov, Czechia; Business ID 21668027). Founder and development lead: Michal Čihař. Core team also includes a community manager and a design/UX lead (3 named team members on the about page). Self-funded via Hosted Weblate subscriptions and support contracts, not VC-backed.
- License / business model: GNU GPLv3+ for the core software (source-available, copyleft). Business model is open-core-adjacent: fully free/libre self-hosting, plus paid Hosted Weblate SaaS and paid self-hosted support contracts.
- Current stable version + release date: 2026.7, released 2026-07-01 (GitHub tag `weblate-2026.7`). Uses calendar-based versioning (YYYY.M[.patch]); prior releases include 2026.6.1 (2026-06-01), 2026.6 (2026-06-01), 2026.5 (2026-05-15), 5.17.1 (2026-04-30 — last release under the old numbering before the calendar-versioning switch).
- Adoption: GitHub stars 5,972; forks 1,300; open issues 493 (WeblateOrg/weblate, checked via GitHub API 2026-07-06). Repo created 2012-02-27. Weblate.org homepage claims "used by over 2,500 libre software projects and companies in over 165 countries." Note: a third-party comparison article (intlpull.com) claims "10,000+ GitHub stars" — this figure does not match the verified GitHub API count (5,972) as of 2026-07-06 and should be treated as unverified/inflated. Hosted Weblate's own instance (for the Weblate project itself) shows 1,316 contributors and 31% translated over the last 12 months, illustrating typical project-level stats on the platform.
- Founded / age: Started 2012 as Michal Čihař's part-time project; company formalized around 2016 when Čihař began dedicating himself full-time to Weblate services (company entity "Weblate s.r.o." formed later, per weblate.org/en/news/archive/weblate-company/). Roughly 14 years old as of 2026.

## Positioning & target audience
- Positions as a "libre" (free-as-in-freedom) web-based continuous localization platform, in contrast to closed commercial TMS (Crowdin, Lokalise, Phrase).
- Targets open-source projects (gratis hosting for libre/public projects) and companies wanting self-hosted or paid-hosted translation management with strict git-native workflows.
- Named adopters shown on homepage: openSUSE, LibreOffice, Fedora, FreedomBox, Collabora Online — skews toward large FOSS/Linux-ecosystem projects.
- Developer-first tool: workflow and UI are oriented around repository state and file formats rather than a translator-agency experience.

## Core concepts & architecture
- Git-repo-as-source-of-truth: translation files (of any supported format) live in the project's VCS repo; Weblate clones/pulls the repo, parses translation files into its DB, and exposes them for web-based translation.
- Continuous localization loop (per official docs): (1) developers push source-string changes to the repo, (2) Weblate pulls and re-parses, (3) translators work in Weblate's web UI, (4) Weblate performs "lazy commits" — batching translator edits into commits grouped by author rather than one commit per change, (5) commits are pushed upstream (automatically or via configured trigger), (6) repeat.
- Update mechanisms: webhook-triggered pulls from GitHub/GitLab/Bitbucket/etc., manual triggers via UI/API/wlc, `AUTO_UPDATE` config, or scheduled `updategit` management command; nightly fetches for performance.
- Component/project hierarchy: a "Project" contains multiple "Components" (roughly one component per translatable resource/file-set within a repo), each with its own VCS config, file mask, and language set.
- Conflict handling: recommends monolingual file formats (translators add new strings only inside Weblate) to avoid merge conflicts; also supports repo locking via REST API/wlc during external edits, and advises avoiding squash merges so Git can recognize upstream changes during rebase.
- Translation propagation: identical source strings across components can auto-receive the same translation; a "Consistency" check flags cases where identical strings diverge across components.
- Quality checks: 30+ checks (per third-party comparison, corroborated by docs categories) spanning format-string validation (25+ language/framework format checks), punctuation/spacing (including French non-breaking-space rules), XML/HTML markup matching, Fluent reference checks, whitespace/zero-width-space detection, unchanged-translation detection, cross-component inconsistency, and missing-plural-form detection. Also includes "Source checks" (flagging problematic source strings for developers) and "Automatic fixups" (e.g., normalizing `...` to `…`).
- Intermediate language workflow: lets developers proofread/normalize source strings before they reach translators.

## Developer workflow & tooling
- VCS backends: Git and Mercurial natively; direct integrations with GitHub, GitLab, Bitbucket, Pagure, Azure Repos, Gitea, and Forgejo (PR/MR-based push workflows supported, including exempting the Weblate bot user from branch-protection rules).
- REST API: full API for projects/components/translations/strings, used for automation, CI integration, and locking.
- CLI: `wlc` — Python library + command-line client (installable via pip, uvx, or Docker) wrapping the REST API. Supports repository operations (commit/pull/push/reset/status), listing projects/components/translations/languages, statistics/history, file download (with format conversion) and upload, and component locking.
- Add-ons: pluggable workflow automations (e.g., auto-updating file formatting, JSON sorting, generating pseudo-locales, enforcing consistency, git-squash strategies) configurable per component.
- Review workflow: peer review/approval states, per-string comments, full change history, glossaries, screenshots for translator context, and translation memory for reuse across projects.

## Supported file formats
- 50+ formats total (widest format coverage among open-source TMS per independent comparison, vs. 8-15 for competitors like Tolgee/Pontoon).
- gettext PO/POT is a foundational/flagship bilingual format (Weblate's origins are gettext-centric), alongside XLIFF (1.1, 1.2, 2.0).
- Also: JSON variants (incl. WebExtension JSON), YAML, CSV, Android XML resources, Apple iOS/macOS strings, Qt Linguist .ts, .NET RESX/RESW, Fluent, ARB, Markdown, AsciiDoc, HTML, subtitle formats, and more (MDX support added in the 2026.7 release).
- Distinguishes bilingual formats (source+translation in one file, e.g. PO, XLIFF) from monolingual formats (string IDs + separate per-language files); feature support (pluralization, context, flags) varies by format.
- Official guidance: choose the established format native to your tech stack rather than switching for Weblate's sake — favors interoperability over a proprietary format.

## AI features
- Machine translation integrations (large list, admin-configurable per project/site): DeepL (documented max score 91), Google Cloud Translation (Advanced v3 and Basic v2), Microsoft Azure AI Translator, Amazon Translate, Baidu, Alibaba, Youdao Zhiyun, Systran, Netease Sight, SAP Translation Hub, ModernMT, ModernMT-compatible, ModernMT, ModernMT, Yandex.
- LLM-based services explicitly listed: OpenAI, Azure OpenAI, Anthropic Claude, and (new in the 2026.7 release) Mistral.
- Self-hostable/open-source MT: LibreTranslate, Ollama, Apertium APy, LTEngine (LibreTranslate-compatible).
- Translation-memory-based suggestion services: MyMemory, Weblate's own Translation Memory (workspace-level TM added in 2026.7), tmserver, Glosbe.
- Priority/scoring system: 100% Translation Memory matches take priority over MT; MT services are ranked by a configured max score, and higher-scoring suggestions override lower ones.
- "Advanced" (LLM) services receive extra context beyond the raw string: string explanations, secondary-language translations, quality-check failures, and glossary entries — used to improve LLM-generated suggestion quality.
- Extensible: custom MT backends can be added in Python by subclassing `MachineTranslation` and registering it.
- No agentic/automated full-project-translation workflow surfaced in docs beyond per-string suggestions and add-on-triggered "automatic translation" (propagating existing translations/MT across strings/components on update).

## Pricing
- Self-hosted: gratis (GPLv3, run your own instance); optional paid support contracts — Basic Support €53/month, Extended Support €106/month (per weblate.org/en/hosting/, 2026-07-06).
- Hosted Weblate (SaaS) — priced by total strings across all used languages, monthly or yearly (20% discount yearly), 14-day free/gratis trial, all tiers include unlimited projects/components/translators:
  - 10k strings: €47/mo or €470/yr
  - 40k strings: €70/mo or €700/yr
  - 160k strings: €114/mo or €1,140/yr
  - 640k strings: €193/mo or €1,930/yr
  - 2.5M strings: €342/mo or €3,420/yr
  - 10M strings: €616/mo or €6,160/yr
  - Custom/larger: contact sales
- Libre plan: gratis Hosted Weblate for public open-source projects, at the same limits as the 160k tier — the flagship "gratis for libre" offer.
- Payment methods: credit card, bank transfer, cryptocurrency. Prices exclude 21% VAT for EU/Czech customers.

## Strengths
- Widest file-format coverage of any open-source TMS (50+ formats vs. single digits/low teens for competitors).
- Deepest git-native workflow: real VCS integration (not just import/export), lazy/grouped commits, PR-based push flows, webhook-driven sync.
- Large, mature quality-check library (30+ checks) covering format strings, markup, punctuation, plurals, and cross-component consistency.
- Longest track record among open-source TMS (started 2012) and the largest community/ecosystem by most measures (GitHub activity, contributor count, third-party comparisons rank it as "most mature").
- Broadest MT/LLM integration list, including major LLM providers (OpenAI, Azure OpenAI, Anthropic, Mistral) alongside traditional MT engines, plus self-hostable MT options (LibreTranslate, Ollama) for privacy-sensitive setups.
- True gratis tier for libre/open-source projects on the hosted SaaS, not just a time-limited trial.

## Weaknesses & criticism
- UI/UX has drawn sharp independent criticism: a detailed practitioner writeup (river.me, "How to use Weblate") calls the UI/UX "abysmal" and "one of the most confusing UIs I've ever used," citing: primary CTAs that aren't the action a user actually wants; disabled vs. editable fields with no visual distinction ("actively misleading" styling); multiple inconsistent search bars; a near-invisible "Create new string" button; and buried, multi-click access to per-language history.
- Third-party TMS comparison (intlpull.com, 2026) describes it as having a "steeper learning curve for non-technical users," a "developer-focused" (not translator-friendly) interface, being "resource-intensive for large translation volumes," and requiring "ongoing maintenance and updates."
- Operationally heavier to scale: community/GitHub discussion (e.g., issue #1586, "Troubleshooting performance for large components") and comparison sources note that large-scale/enterprise deployments need database optimization, caching, and careful infrastructure sizing; Kubernetes-based scaling adds operational complexity versus lighter competitors.
- Some inflated/unverifiable secondary claims circulate (e.g., a third-party "10,000+ GitHub stars" figure that does not match the actual GitHub count of 5,972 as of 2026-07-06) — treat marketing-adjacent secondary sources with caution.

## What they do differently
- Git is the actual source of truth, not an import/export target: Weblate clones the repo, parses translation files in place, and translators edit against live repo state; changes flow back via real commits (grouped/"lazy" per author) and pushes/PRs, not a proprietary sync log. This is the closest architectural analogue to Palamedes' source-string-first .po model among commercial/hosted TMS competitors.
- Deliberately format-agnostic but gettext/PO-rooted: unlike API-first TMS that normalize everything to an internal JSON/key-value model, Weblate treats each of its 50+ formats as first-class where possible, preserving bilingual PO/XLIFF semantics (plurals, context, flags) rather than lossy conversion.
- Monolingual-vs-bilingual format distinction is a first-order concept in its docs and conflict-avoidance strategy (recommending monolingual formats specifically to prevent merge conflicts when translators add new strings) — a git-workflow concern competitors' hosted-SaaS models don't need to think about.
- Licensing/business model inversion vs. typical TMS: the product itself is GPLv3 copyleft and self-hostable for free; revenue comes from hosting convenience and support, not from the software license — and libre/open-source projects get the SaaS tier gratis rather than a crippled free tier.
- Lazy/grouped commit strategy is a specific, named mechanical detail (batches translator edits per-author into commits, triggered by conditions like different-translator edits to the same string, upstream merges, or age thresholds) — an explicit attempt to keep a readable git history despite many small web-UI edits.
- Broadest LLM-as-MT-backend integration among open-source TMS, including feeding LLMs extra context (glossary entries, quality-check failures, secondary-language translations) rather than treating them as a drop-in replacement for traditional MT APIs.

## Sources
- https://weblate.org/en/features/ (accessed 2026-07-06)
- https://weblate.org/en/ (accessed 2026-07-06)
- https://weblate.org/en/about/ (accessed 2026-07-06)
- https://weblate.org/en/hosting/ (accessed 2026-07-06)
- https://docs.weblate.org/en/latest/formats.html (accessed 2026-07-06)
- https://docs.weblate.org/en/latest/admin/machine.html (accessed 2026-07-06)
- https://docs.weblate.org/en/latest/admin/continuous.html (accessed 2026-07-06)
- https://docs.weblate.org/en/latest/wlc.html (accessed 2026-07-06)
- https://docs.weblate.org/en/latest/user/checks.html (accessed 2026-07-06)
- https://github.com/WeblateOrg/weblate (GitHub API, accessed 2026-07-06)
- https://github.com/WeblateOrg/weblate/releases (accessed 2026-07-06)
- https://weblate.org/en/news/archive/weblate-company/ (accessed 2026-07-06)
- https://river.me/how-to-use-weblate/ (accessed 2026-07-06)
- https://intlpull.com/blog/open-source-tms-comparison-2026 (accessed 2026-07-06)
- https://hosted.weblate.org/projects/weblate/ (accessed 2026-07-06)
