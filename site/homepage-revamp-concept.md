# Homepage Revamp — Implementation Concept

Normative content and implementation contract for the palamedes.dev revamp.
The exploration history moved to
[`homepage-revamp-exploration.md`](homepage-revamp-exploration.md); the static
HTML mocks remain unchanged in [`homepage-revamp-mocks/`](homepage-revamp-mocks/).

Status: content direction approved after review on 2026-08-12. The homepage
now includes the hero, integration band, receipts, proof ledger, matrix,
question routing, trust section, and FAQ. The integration band uses linked,
unmodified framework marks with recorded sources, checksums, and attributions;
see [`framework-brand-usage.md`](framework-brand-usage.md) and
[`../THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md). The product owner
accepted the remaining Next.js trademark-risk decision while Palamedes seeks
confirmation from Vercel. Supporting pages and their responsive behavior
remain separately tracked implementation work.

## 1. Authority and scope

This document wins when sources disagree:

1. Current product behavior, checked-in data, tests, and ADRs define what is
   true.
2. This document defines the current market position, claims, page hierarchy,
   and visual rules.
3. The exploration archive explains how the decisions were reached.
4. Static HTML mocks and screenshots are non-normative visual references. They
   must not override this document's content, order, terminology, or claims.

The first implementation pass is desktop-first. Responsive design follows
after the content hierarchy and marketing axes settle. That sequencing does
not relax three implementation constraints: every claim must make sense
without a graphic, data tables need a linear reading order, and every visual
benchmark needs an equivalent text/table representation.

## 2. Positioning

### Audience

The primary audience is TypeScript developers and technical leads choosing an
i18n foundation for a modern, long-lived application. Their starting point may
be greenfield, i18next, Lingui, React Intl, or another stack. No incumbent is
the center of the homepage position.

Comparison and migration pages address source-specific questions. Framework,
locale-routing, performance, architecture, and workflow landing pages address
the questions visitors actually arrive with and lead them back to one stable
product position.

### Primary promise

> I18n should be a foundation, not a recurring migration.

Palamedes keeps authoring, catalogs, framework wiring, locale architecture,
tooling, and runtime behavior coherent as a TypeScript application grows. The
site should make Palamedes feel like a technically sound long-term choice, not
merely the quickest library to install.

This is positioning, not a guarantee that no team will ever migrate. Public
copy may say "designed not to become your next migration" or "built as a
foundation you can keep". It must not say "you will never migrate again."

### Headline system

The decided display headline remains:

> **CLEAR. COMPLETE. FAST.**
>
> **PICK THREE.**

The three words explain why the foundation can last:

| Word     | Meaning                                                | Product consequence                                                                                                                         | Adjacent proof                                                           |
| -------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| CLEAR    | One authoring and runtime model                        | Messages stay beside the UI; no parallel ID bookkeeping; transformed code reaches one `getI18n()` contract                                  | Real code, readable `.po` catalogs, live locale behavior                 |
| COMPLETE | First-party integration plus a complete local workflow | The framework glue, locale architectures, extraction, catalog update, audit, merge, compilation, and runtime are already part of the system | 6 server-framework integrations, 4 locale architectures, pipeline ledger |
| FAST     | Native, cached tooling                                 | Extraction remains responsive on a realistic large corpus instead of becoming a tax as the repository grows                                 | Checked benchmark report and rounded same-scope results                  |

`COMPLETE` never means hosted TMS, machine translation, or every UI framework.
The public label should be **complete local workflow** wherever the shorter word
could imply unlimited product scope.

### Hero copy direction

Recommended lede:

> Build i18n on one coherent TypeScript foundation: source-local messages,
> first-party framework integrations, four proven locale architectures,
> repository-owned catalogs, and a native toolchain that stays fast as the
> codebase grows.

Recommended actions:

- Primary: **Choose your framework** → `/frameworks`
- Secondary: **Review the architecture** → `/architecture`
- Proof link near the receipts: **Inspect the evidence** → `/proof`

The quickstart remains useful but is not the primary value proposition. Avoid
"first translation in 5 minutes" as the repeated site-wide conversion hook.
If retained as a guide label, treat it as the name of the guided path rather
than a guaranteed completion time.

## 3. The two breadth axes

Framework coverage and locale architecture are related proof surfaces, but
they are not the same capability and must not be collapsed into "25 examples."

### First-party framework integration

The valuable claim is that Palamedes supplies the integration code and tests,
not that it appears compatible in a logo table.

- 6 server-framework families: Next.js, TanStack Start, SolidStart, Waku,
  React Router, and Remix v3.
- Vite is the shared build integration and has its own verified surface.
- Hono and Express prove the same runtime model on backend request handlers.
- Use **first-party integration**, **already wired**, or **verified adapter**.
  Do not reduce this to "compatible with."

### Locale architecture

Cookie, route prefix, subdomain, and top-level domain are four distinct product
architectures. Palamedes provides real example applications for each strategy
across every server-framework family, including the host-specific request,
routing, hydration, and runtime wiring.

This is an out-of-the-box engineering asset, not decorative matrix breadth.
The homepage may summarize it as:

> 6 frameworks. 4 locale architectures. Already wired and verified.

### Role of the 25 example apps

The 25 apps explain how the two axes are verified: 24 framework × locale
applications plus the separate Vite MDX example. That count belongs on
`/proof` and the detailed framework surface, not as the primary receipt for
`COMPLETE` in the hero.

The matrix must preserve verification depth:

- browser-verified where a real UI flow exists;
- smoke-verified where the current host surface is server-only or preview;
- live-demo availability as a separate hosting state;
- Remix v3 and other preview qualifications kept visible.

## 4. Claims and number policy

### Performance claim

Use the bounded statement:

> **29–79× faster than the three same-scope workflows in our checked run.**

The range covers Lingui, General Translation, and i18next-cli on the realistic
1,500-file extract-and-catalog-update corpus. It is not a claim about every i18n
tool, every machine, every workload, or an isolated engine benchmark.

React Intl remains visible as a narrower-scope reference. Its extraction-only
command does not update locale catalogs, so it stays out of the headline range.

Comparison pages must say **workflow**, **extract-and-update run**, or similarly
bounded language. Do not describe the measured ratio as an engine being a
specific multiple faster.

### Rounded public numbers

Public marketing copy deliberately avoids benchmark pseudo-precision:

- display whole millisecond values below one second;
- display one decimal place for multi-second values;
- floor public speedup factors so copy never rounds a result upward;
- keep exact medians and ratios in the checked report and machine-readable data;
- derive all displayed values from those exact sources and fail the build when
  they drift.

For the current realistic report, the public presentation is:

| Workflow            | Display time | Display factor | Scope                           |
| ------------------- | -----------: | -------------: | ------------------------------- |
| Palamedes           |    **84 ms** |         **1×** | extract + catalog update        |
| React Intl          |       476 ms |             5× | extraction only; narrower scope |
| Lingui              |        2.5 s |            29× | same-scope workflow             |
| General Translation |        6.1 s |            72× | same-scope workflow             |
| i18next-cli         |        6.6 s |            79× | same-scope workflow             |

The exact values remain 83.89 ms, 475.85 ms, 2,480.24 ms, 6,116.43 ms, and
6,644.63 ms in `site/app/data/bench.ts` and the checked benchmark report.

### Benchmark presentation

The preferred first design is a compact **results ledger with large numbers**,
not a unit grid:

- one row per workflow;
- the rounded time is the dominant value;
- the floored factor is secondary;
- the scope label is visible in the same row;
- Palamedes is emphasized with typography and one accent, not by shrinking it
  to an unreadable linear bar;
- the React Intl qualification is adjacent, never a detached footnote;
- the environment, corpus, date, and report link sit in the table header/footer.

The previous Isotype unit grid is archived as an explored alternative. At
roughly 80 units it creates visual mass without adding corresponding
information and must not be the default on the homepage or `/proof`.

### Claim register

| Claim                                       | Evidence                                                   | Constraint                                                                   |
| ------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| One source-to-runtime model                 | runtime code, transforms, ADR-005/022/023                  | supported packages and hosts only                                            |
| Complete local workflow                     | CLI/core behavior, ferrocat, package/docs inventory        | no hosted TMS, MT, or dashboard                                              |
| 6 first-party server-framework integrations | generated matrix and adapter packages                      | Remix v3 remains qualified                                                   |
| 4 implemented locale architectures          | 24 real matrix applications                                | hosting/live-demo state is separate                                          |
| 25 smoke-verified examples                  | generated content stats and CI                             | count is verification detail, not breadth by itself                          |
| 29–79× on same-scope workflows              | checked realistic benchmark report                         | three measured workflows, dated machine-local run                            |
| 5× React Intl reference                     | same report                                                | narrower extraction-only scope; excluded from headline range                 |
| Repository-owned catalogs, MIT, no account  | repository, license, product scope                         | hosted Palamedes+ may remain optional later                                  |
| Designed as a durable foundation            | architecture, tests, docs, ADR trail, maintenance practice | positioning supported by product evidence, not a guaranteed customer outcome |

## 5. Homepage information architecture

The homepage is an overview of the stable position, not a migration page and
not a compressed copy of every technical document.

1. **Masthead + hero** — Pick three; durable-foundation lede; framework and
   architecture actions.
2. **First-party integration band** — real framework wordmarks, each linked to
   its verified page; compatibility language avoided.
3. **Tri-band + receipts** — Clear, Complete local workflow, Fast; receipts
   adjacent and qualified.
4. **Clear** — authoring comparison, real code, live locale behavior.
5. **Complete** — three distinct artifacts:
   - first-party framework wiring;
   - four locale architectures;
   - local workflow pipeline and ships-with ledger.
6. **Fast** — terminal artifact plus the large-number results ledger.
7. **Why this holds** — mechanism summary and route into `/architecture`.
8. **Verified matrix** — depth and status per framework × locale architecture.
9. **Built to remain a sound choice** — tests, documentation, maintenance,
   release discipline, ADRs, ownership, and honest exclusions.
10. **Start from your question** — routes to framework, locale architecture,
    performance, migration, and comparison landing pages.
11. **FAQ** — production maturity, framework fit, translators, AI/TMS scope,
    catalogs, and migration.
12. **Closing action** — choose a framework; inspect architecture/evidence.

The exact section count may change during implementation when adjacent blocks
read better as one section. The message order and proof relationships above are
normative; the twelve-box structure in the screenshots is not.

## 6. Supporting surfaces and navigation

### `/architecture`

Rename the proposed `/engineering` page to **Architecture** and give it a
top-level navigation item. This is a technical product for technical
evaluators; the system design is part of the product, not supplementary blog
content.

- Route: `/architecture`
- Navigation: **Architecture**
- Eyebrow: **Inside Palamedes**
- Hero: **“Written in Rust” is the boring half.**
- Diagram label: **The machine**

The page keeps the machine map, wrapper question, mechanisms, artifacts, and
ADR chips from the exploration. Replace illustrative compiled output with real
generated output before publication.

### `/proof`

Use receipts as artifacts: benchmark ledger, verification pipeline, detailed
matrix, catalog/ICU boundaries, and decision ledger. Replace the explored unit
grid with the large-number result table unless implementation testing produces
a clearly better truthful treatment.

### `/compare` and rival pages

Keep the hub's measured/not-measured/researched ledger and honest exits. Keep
verdict-first rival pages, but phrase benchmark comparisons as workflow results
and use rounded public factors. Comparisons are acquisition surfaces, not the
homepage's identity.

### Landing-page system

Create/promote focused answers for questions such as:

- framework and RSC integration;
- cookie vs route vs subdomain vs TLD locale architecture;
- extraction performance in large repositories;
- PO catalog ownership and migration;
- server request isolation;
- long-term maintainability and architecture;
- tool-specific comparisons.

Each landing page may adapt vocabulary and proof to its entry question while
preserving the same product truth and constraints.

## 7. Visual direction

### Base language

Keep **Monument core × Editorial masthead** with warm paper, navy ink, bronze
accent, Cinzel Hellenic display type, mono micro-labels, hairline rules, and
proof artifacts as imagery. Use the Greek/Palamedes story as a distinctive
accent in crest, type, and closing details; it must not determine the entire
information architecture.

Real framework marks remain brand assets and require their individual usage
checks. Do not present framework marks as customer logos or adoption proof.

### Streamline icon system

All non-brand marketing pictograms must come from one set:
**Streamline Sharp Duo** under the project's existing Streamline Pro license.
Do not mix Sharp Duo with Sharp Line, Ultimate, Core, Material, Lucide, or
other Streamline sets. Framework/vendor logos are the only intentional
exception.

Sharp Duo was selected after comparing Ultimate Light, Sharp, and Plump against
the bronze/navy/Cinzel direction. Its constructed geometry gives the site a
distinct high-tech edge, while two customizable color planes add visual depth
without introducing illustration noise. Ultimate Light was coherent but too
neutral beside the masthead; Plump's cartoon softness conflicted with the
calm, technical authority of the product. Use navy and bronze as the two icon
colors. A one-color treatment is allowed where the layout needs restraint, but
the asset must still be the Sharp Duo version.

The first implementation selection is fixed to eight icons, researched in the
Streamline catalog on 2026-08-12:

| Use                          | Sharp Duo asset                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Clear / source inspection    | [Code Analysis](https://www.streamlinehq.com/icons/download/code-analysis--25116)                                         |
| Complete / pipeline          | [Deployment Workflow Collaboration](https://www.streamlinehq.com/icons/download/deployment-workflow-collaboration--25115) |
| Fast / benchmark             | [Browser Flash](https://www.streamlinehq.com/icons/download/browser-flash--25121)                                         |
| Architecture                 | [Web Hierarchy](https://www.streamlinehq.com/icons/download/web-hierarchy--25115)                                         |
| First-party adapter breadth  | [App Widgets Plugin Extension](https://www.streamlinehq.com/icons/download/app-widgets-plugin-extension--25122)           |
| Locale architecture          | [Globe App Network](https://www.streamlinehq.com/icons/download/globe-app-network--25115)                                 |
| Documentation / maintenance  | [Programming Book](https://www.streamlinehq.com/icons/download/programming-book--25116)                                   |
| Proof / verified application | [Browser Check](https://www.streamlinehq.com/icons/download/browser-check--25121)                                         |

These are the defaults for the first implementation, not eight mandatory page
placements. Start with Clear, Complete, Fast, and Architecture; add the other
four only where they materially improve scanning. A replacement requires a
like-for-like Sharp Duo asset and an update to the manifest. Avoid icon cards,
decorative repetition, and a pictogram beside every paragraph.

### Streamline illustration system

Use a second, explicitly separate asset layer for the few places that benefit
from a richer editorial image: **Streamline UX Duotone**. This does not loosen
the icon rule. Small and repeated pictograms remain Sharp Duo; larger
illustrative anchors remain UX Duotone. Do not introduce UX Colors, UX Line,
Plump, or another illustration family.

The first implementation should try exactly three illustrations:

| Intended placement                                 | UX Duotone asset                                                                                            |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Brand story, maintainer trust, or closing sequence | [Quill Software Writing](https://www.streamlinehq.com/illustrations/download/quill-software-writing--10413) |
| Complete local workflow introduction               | [Flowchart Paper](https://www.streamlinehq.com/illustrations/download/flowchart-paper--10295)               |
| `/proof` verification/testing introduction         | [App Testing](https://www.streamlinehq.com/illustrations/download/app-testing--10295)                       |

Treat these placements as an implementation experiment, not a requirement to
ship all three. Quill Software Writing has the strongest brand fit and should
be tested first. Flowchart Paper must introduce the real workflow artifact,
not replace it. App Testing must support the evidence surface, not turn proof
into a generic decorative scene.

UX Duotone uses the same navy and bronze palette as Sharp Duo. Remove or
recolor its default blue fields; preserve the original geometry and readable
two-tone hierarchy. Use illustrations at editorial scale with surrounding
space. Never reduce them until they read as competing icons, and never place
an illustration beside every section.

### License and repository handling

The account screen reviewed on 2026-08-12 confirms **Full Access plan / 1
user**, including **All Pro Icons** and **All Pro Illustrations**. The account
owner is the licensed source user and exports the prepared selection;
contributors may work with those project assets without receiving access to
the full source library.

Repository rules:

- stay below the standard allowance of 100 unique icons per project; the first
  selection uses eight;
- stay below the separate allowance of 50 illustrations per project; the first
  experiment uses three;
- store only used, optimized SVGs under
  `site/public/icons/streamline/sharp-duo/` and
  `site/public/illustrations/streamline/ux-duotone/`;
- never publish the selection as a standalone icon package, public asset
  library, design resource, or user-selectable icon catalog;
- keep Streamline assets outside the repository's MIT grant and add a root
  `THIRD_PARTY_NOTICES.md` entry when the first SVG is committed;
- include the required open-source attribution and link to Streamline in that
  notice and in an appropriate public credits/about surface;
- keep the account screenshot, invoice, and accepted license text in private
  company records, not in the public repository;
- count unique assets, not placements; repeated use of one SVG still counts as
  one icon;
- treat the weekly 1,000-asset figure as an export limit, not a project usage
  allowance.

The project manifest is
[`streamline-asset-manifest.md`](streamline-asset-manifest.md). It records the
chosen assets without relicensing or redistributing them.

Before assets ship:

1. export the selected SVGs from Sharp Duo and UX Duotone using the licensed
   account;
2. compare them at real display sizes against the Cinzel/ledger type and only
   replace an asset inside its respective set;
3. preserve one shared stroke treatment and map the two color planes to the
   navy/bronze tokens; use `currentColor` for one-color placements where
   practical;
4. complete the manifest with export date, repository path, and file hash;
5. add the third-party notice and public attribution before committing SVGs;
6. verify accessible labels: decorative icons stay hidden, meaningful icons
   receive adjacent text rather than standalone tooltips.

## 8. Implementation sequence

1. Treat this document as the content contract and keep the exploration/mocks
   available for visual reference.
2. Update `PRODUCT.md` and the durable positioning record to match the
   foundation narrative, current tokens, `/architecture`, and icon policy.
3. Extend benchmark guards to derive/verify rounded public times and floored
   same-scope factors.
4. Implement the desktop homepage with existing components where they remain
   useful; do not recreate a stale screenshot literally.
5. Implement `/architecture`, `/proof`, and `/compare` against the same claim
   register.
6. Build focused landing pages and connect them through the "start from your
   question" paths.
7. Design and verify responsive/mobile behavior once content hierarchy and
   desktop artifacts are stable.
8. Run accessibility, no-JS, reduced-motion, route, data-drift, and visual
   checks before release.

## 9. Reopening conditions

Revisit the position or hierarchy when observed visitors cannot explain what
Palamedes is, why the first-party integration matters, or why it is a sound
long-term choice; when framework/locale proof materially changes; when current
benchmark results invalidate the public range; or when adoption evidence shows
that a different product consequence drives evaluation.

Until real traffic and qualitative feedback exist, treat copy expression and
section compression as testable implementation choices. Keep product behavior,
claim scope, proof, and constraints stable.
