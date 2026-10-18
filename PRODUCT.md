# Product

## Register

brand

## Users

TypeScript developers and tech leads evaluating maintainable i18n tooling for
modern applications. Palamedes is especially relevant for
server-rendered apps, long-lived codebases, and teams that want to avoid
framework-specific lock-in, but it does not assume that one product uses
multiple frameworks. These readers are skeptical of marketing claims, read
docs and benchmarks before adopting, and care about long-term maintainability
more than novelty. Secondary audience: translators and OSS contributors
navigating the docs, ADRs, and API reference.

## Product Purpose

Palamedes is open-source i18n tooling built around one coherent model from
source to runtime: macro-style authoring next to the code, source-string-first
`.po`/FCL catalogs, one `getI18n()` runtime contract, and a Rust core for
transformation, extraction, catalog updates, audits, merging, and compilation.
First-party adapters connect that model to supported hosts without making any
one framework the product center. The site (palamedes.dev) must convert
skeptical developers by _showing_ proof — browser-verified example matrices,
checked-in benchmarks, and ADRs — rather than telling slogans. The intended
consequence is a durable i18n foundation that a team does not need to replace
when its codebase, framework, or translation workflow grows. Success: a
visitor understands that consequence, sees both the first-party framework
integration and the supported locale architectures, and chooses the next path
that matches the evaluation question: framework setup, architecture, or
evidence. The quickstart remains useful documentation, not the primary product
promise.

The experimental Rust application path extends source-string authoring and PO
catalog compilation to native CLIs and services. Its Cargo integration produces
external language files; all languages, including English, stay outside the
executable. Present it as an additional evaluation path with its own guide and
example, not as full parity with the TypeScript workflow. The crates remain
unpublished, and the current subset is text, display arguments, and string selects.
Keep those limits beside the claim that compatible translations can ship without
rebuilding an application.

## Product And Marketing Narrative

This file is the concise, current context for product and marketing work. The
durable scope and positioning decision, including its rationale and review
triggers, lives in
[ADR-001](adr/001-project-scope-and-positioning.md).

Open the homepage with the four-word promise **Just write the sentence.** and
the same sentence morphing through several languages. Keep **Clear. Complete.
Fast. Pick three.** as the design-goal statement that sums up what changes.
Explain its promises through concrete application work: Clear means readable macros and ready-made
rich-message and choice components; Complete means first-party framework
integration and checked locale architectures; Fast means macros compiled to
message lookups, automatic browser fragments, shared server catalogs, and the
native extraction/catalog workflow. Show those benefits before asking visitors
to inspect the architecture. Keep extraction timings separate from browser
delivery and server memory evidence.

The public narrative follows one spine and does not assume a Lingui migration;
the reader may be starting greenfield or from any established i18n stack:

1. I18n should be a foundation, not a recurring migration.
2. Palamedes keeps one opinionated model coherent from TypeScript source to
   runtime.
3. A native toolchain covers the complete local workflow, while first-party
   adapters provide the framework glue instead of merely claiming
   compatibility.
4. Framework breadth and locale architecture are two different proof axes:
   supported hosts demonstrate integration depth; cookie, route, subdomain,
   and TLD examples demonstrate deployable locale-policy choices.
5. The verified example matrix, CI flows, benchmark results, tests,
   documentation, and ADRs make those claims inspectable.
6. Palamedes+ may add managed automation and collaboration later; Palamedes
   remains useful without it.

## Public Content And Evidence

The homepage is a guided tour for someone choosing an i18n library who may
never have used i18n tooling. Every section opens with a line that earns
attention, then explains the mechanism in plain words a newcomer can follow —
what a macro is, what extraction and a `.po` catalog are, what compiling a
message means, why messages load per screen, why the core is native, why
framework wiring is the real work — and shows the real artifact beside it.
After what changes and how one sentence travels through the toolchain, the
page plays back the checked benchmark, explains framework integration and URL
strategies, compares alternatives honestly (including when not to choose
Palamedes), and closes with receipts, the maintainer's origin story,
situation-based next steps, and the FAQ. Framework
setup, locale policy, performance, migration, and comparison pages answer
focused entry questions while preserving the same product position.
Architecture is a primary evaluation path, with its own top-level navigation
item. Comparisons do not define the homepage's identity.

- Describe a **complete local workflow** when "complete" could imply a hosted
  TMS, machine translation, or support for every framework.
- Present a durable foundation as a design goal, never a guarantee that a team
  will never migrate again. Setup guides do not promise a completion time.
- Keep framework integration, locale architecture, verification depth, and live
  demo availability distinct. Example counts describe evidence, not additional
  framework support. Preserve Preview qualifications beside the relevant claim.
- Distinguish the implementation on `main` from available registry releases.
  During the v2 publication hold, identify upcoming behavior as a preview and
  direct evaluators to repository examples and the migration guide.
- Bound performance claims by the measured workflow, corpus, environment, and
  report date. Keep extraction, browser delivery, and server memory evidence
  separate. Use the presentation policy in
  [ADR-011](adr/011-editorial-visual-brand-system.md#benchmark-presentation).
- Keep every claim understandable without its graphic. Tables need a linear
  reading order, and visual benchmark results need equivalent text or tables.
- Show idiomatic code. In JSX, write messages with the `<Trans>`, `<Plural>`,
  and `<Select>` components; use the `t` macro only where JSX children cannot
  reach (attributes such as `alt` or `aria-label`) or in non-JSX code such as
  loaders, server functions, and request-scoped server helpers. Do not mix both
  styles in one example without that reason.

`PRODUCT.md` owns current messaging; ADR-001 and ADR-011 own durable positioning
and visual decisions. Completed implementation plans and discarded design
explorations belong in Git history, not beside these current sources.

## Brand Personality

The durable visual and editorial contract is recorded in
[ADR-011](./adr/011-editorial-visual-brand-system.md).

Precise, verifiable, calm — and warm enough to be felt. The visual voice is
**Inscription and ledger, opened up**: a classical Palamedes masthead over an
editorial page that explains before it proves. Warm paper ground (`#faf9f4`),
parchment (`#f3efe3`) and mist (`#e8edf2`) bands with soft transitions, navy
ink (`#0e2a4d`) that is never used as a background, one bronze accent
(`#8e6628`), inscription-scale Cinzel Hellenic headlines, readable 16–21 px
body copy, hairline rules, and tabular numbers. Code reads like a printed
listing on a light ground, not a dark editor.
Product specimens — real code, a real `.po` entry, a rendered component in
several languages, URL bars — are the imagery. Terminal green/amber remain
reserved for CLI output. Hard rules: zero border-radius, zero box-shadow, zero
gradients. Confidence comes from clear explanation and evidence, not visual
loudness.

Non-brand marketing pictograms come exclusively from **Streamline Sharp Duo**
under the project's existing Pro license, colored with the navy and bronze
tokens. Do not mix it with Sharp Line, Ultimate, Core, Lucide, or another set.
Real framework and vendor marks are the only intentional brand exception.
The licensed exports, provenance, and hashes are recorded in
`site/streamline-asset-manifest.md`; the former Lucide mapping in the
first-party `FeatureIcon` component has been removed. ARDO may retain Lucide as
an implementation dependency for its own documentation chrome.

## Anti-references

- Generic SaaS landing pages: gradient heroes, glassmorphism, rounded cards
  with drop shadows, purple-to-blue gradients, dark-mode-with-glow.
- Docs-framework default look (unthemed VitePress/Docusaurus/ARDO chrome)
  bleeding into the brand surface — the site must look like Palamedes, not
  like its tooling.
- Marketing-speak ("seamless", "blazingly fast" without receipts). Every
  number on the site is backed by a checked-in benchmark or CI artifact.

## Design Principles

1. **Explain, then show the work.** Name the reader's situation and the
   benefit in plain words first; then let proof artifacts (specimens,
   terminal output, benchmark tables, screenshot matrices) carry the claim.
   Real numbers, mono + tabular, always.
2. **Hairlines, not boxes.** Structure comes from rules and the framed column
   grid, never from cards, shadows, or rounded containers.
3. **One accent, spent deliberately.** Bronze `#8e6628` marks interaction and
   emphasis; everything else is ink on paper.
4. **The docs are part of the brand.** Reference pages share the same tokens
   and typographic voice as the landing pages; theme the framework via its
   official API instead of forking or fighting it.
5. **Calm over loud.** Palamedes sells a "calmer default" for i18n; the site
   demonstrates that temperament through restraint and evidence.

## Accessibility & Inclusion

- Body text contrast ≥ 4.5:1 (ink on paper passes; keep gray-spec text to
  labels ≥ 3:1 or larger sizes).
- Full `prefers-reduced-motion` fallbacks: reveals and route transitions
  degrade to instant/static states (already implemented; keep it that way).
- Keyboard-reachable nav and search; visible focus states in the bronze accent
  with sufficient contrast against their surface.
- Content readable without JavaScript where prerendering allows.
