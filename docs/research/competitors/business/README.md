# Business / solution vendors — overview

Vendors shipping a software solution (TMS / localization platforms, hosted or
self-hosted). Relevant later for a commercial "Palamedes Plus" offering.
Snapshot date: **2026-07-06** (see each dossier's frontmatter; every fact below
is sourced in the linked dossier).

## Comparison table

| Fact                | [Crowdin](crowdin.md)                   | [locize](locize.md)                   | [General Translation](general-translation.md) | [Tolgee](tolgee.md)                    | [Phrase](phrase.md)                 | [Lokalise](lokalise.md)                       | [Transifex](transifex.md)           | [Weblate](weblate.md)                           |
| ------------------- | --------------------------------------- | ------------------------------------- | --------------------------------------------- | -------------------------------------- | ----------------------------------- | --------------------------------------------- | ----------------------------------- | ----------------------------------------------- |
| Company / ownership | Crowdin OÜ (EE), bootstrapped, 2009     | inweso GmbH (CH), i18next team, no VC | GT Inc. (SF), ~$2.5M seed, ~2 yrs old         | Tolgee s.r.o. (CZ), ~€500K seed        | Phrase a.s., PE-owned (Carlyle)     | Lokalise (LV, 2017), Adobe via Semrush        | Transifex, owned by XTM (2025)      | Weblate s.r.o. (CZ), self-funded                |
| License / model     | Proprietary SaaS; OSS free tier         | Proprietary SaaS, funds i18next OSS   | FSL SDKs (source-available) + closed SaaS     | Open-core (Apache-2.0 + EE)            | Proprietary SaaS suite              | Proprietary SaaS                              | Proprietary SaaS; OSS CLI           | GPLv3 open source                               |
| Pricing model       | Hosted words (× languages); $0–450+/mo  | Tiers $0–199/mo + usage-based         | $0 + usage-based; Enterprise custom           | €0–499+/mo (keys+seats+credits)        | Seats + words + MTUs; $27–1,245+/mo | Processed words/yr; $144–999+/mo              | Hosted words $160–2,465/mo + AI SKU | Self-host free; hosted €47–616/mo; libre gratis |
| Adoption            | 708 G2 reviews; GitHub, GitLab, Strava  | ~86k npm/wk SDK; Capterra 4.4 (22)    | ~50k npm/wk; 964 ★; Cursor, Cognition         | 4.0k ★; 123k npm/wk; Capterra 4.6 (95) | 4,500+ customers (2023); ~400 staff | Claims 1M users / 3,000+ companies            | Claims 500+ customers; OSS exodus   | 5,972 ★; LibreOffice, Fedora, openSUSE          |
| TMS vs. AI-first    | TMS + deep AI layer                     | TMS + optional AI/MT                  | AI-first (AI is the product)                  | TMS + AI translator                    | TMS + heavy AI (Language AI, QPS)   | TMS + two-tier AI + AI LQA                    | TMS + Transifex AI/TQI              | TMS; MT/LLM as suggestions only                 |
| Source of truth     | Hosted project DB                       | Hosted key DB, versioned              | JSX source + hosted CDN                       | Platform key DB                        | Hosted key/segment DB               | Hosted keys                                   | Hosted resources                    | The git repo itself                             |
| Delivery            | File sync + OTA CDN                     | Runtime CDN (OTA)                     | Build-time + CDN; live AI in dev              | SDK/CDN + file export                  | File sync + OTA                     | File sync + OTA (GB-metered)                  | Runtime OTA (CDS) or file sync      | Commits/PRs back to repo; no OTA                |
| ICU                 | Yes — native (editor, validation)       | Yes (native format)                   | No for JSX (own components); ICU in core util | Yes, native + plural editor            | Yes — Strings (opt-in per project)  | Partial — import detection → own plural model | Yes (Native SDKs ICU-based)         | Partial — QA check flag, no dedicated format    |
| .po / gettext       | Yes, first-class                        | Yes (export, keys/values only)        | No                                            | Yes                                    | Yes                                 | Yes (incl. msgctxt/fuzzy)                     | Yes                                 | Yes — flagship format                           |
| Dev tooling         | CLI, API, GH Action, MCP v2             | CLI, API, GH Action, MCP              | gtx-cli, Locadex agent                        | CLI, API, built-in MCP (early)         | CLI, 8 API surfaces                 | CLI, API v2, Figma plugin                     | tx CLI, API, webhooks               | wlc CLI, API, add-ons                           |
| Self-hosting        | No                                      | No (files bundlable, platform not)    | Escape hatch only                             | Yes (free ≤10 seats)                   | No                                  | No                                            | No                                  | Yes — primary model                             |
| Standout            | MCP for Claude Code; vendor marketplace | saveMissing harvesting; funds i18next | `<T>` JSX units; AI migration agent           | ALT+click + auto-screenshots           | QPS quality-score feedback loop     | Design-tool workflow; words-based billing     | Fileless "Native"/CDS architecture  | Git-native .po workflow, lazy commits           |

## Dossiers

- [crowdin.md](crowdin.md) — the integration-broadest TMS, furthest along on AI-agent interop (MCP)
- [locize.md](locize.md) — i18next-native runtime-CDN TMS, funds the i18next OSS project
- [general-translation.md](general-translation.md) — AI-first vertical stack, youngest and least scrutinized
- [tolgee.md](tolgee.md) — open-core in-context TMS, self-hostable
- [phrase.md](phrase.md) — enterprise suite with the most formalized AI quality scoring
- [lokalise.md](lokalise.md) — developer-oriented TMS with design-tool focus, now Adobe-owned
- [transifex.md](transifex.md) — veteran TMS with fileless OTA architecture and OSS attrition
- [weblate.md](weblate.md) — libre, git-native TMS; architecturally closest to Palamedes
