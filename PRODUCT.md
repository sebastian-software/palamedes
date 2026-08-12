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

## Product And Marketing Narrative

This file is the concise, current context for product and marketing work. The
durable scope and positioning decision, including its rationale and review
triggers, lives in
[ADR-001](adr/001-project-scope-and-positioning.md).

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

## Brand Personality

Precise, verifiable, calm. The visual voice is **Monument core × Editorial
masthead**: a technical ledger with a classical Palamedes accent. Warm paper
ground (`#faf9f4`), navy ink (`#0e2a4d`), one bronze accent (`#8e6628`),
Cinzel Hellenic display type, mono uppercase micro-labels, hairline rules, and
tabular numbers. Terminal green/amber remain reserved for CLI output. Hard
rules: zero border-radius, zero box-shadow, zero gradients. Confidence comes
from evidence density and typographic discipline, not visual loudness.

Non-brand marketing pictograms come exclusively from **Streamline Sharp Duo**
under the project's existing Pro license, colored with the navy and bronze
tokens. Do not mix it with Sharp Line, Ultimate, Core, Lucide, or another set.
Real framework and vendor marks are the only intentional brand exception.

## Anti-references

- Generic SaaS landing pages: gradient heroes, glassmorphism, rounded cards
  with drop shadows, purple-to-blue gradients, dark-mode-with-glow.
- Docs-framework default look (unthemed VitePress/Docusaurus/ARDO chrome)
  bleeding into the brand surface — the site must look like Palamedes, not
  like its tooling.
- Marketing-speak ("seamless", "blazingly fast" without receipts). Every
  number on the site is backed by a checked-in benchmark or CI artifact.

## Design Principles

1. **Show the work.** Proof artifacts (terminal output, benchmark tables,
   screenshot matrices) are the imagery. Real numbers, mono + tabular, always.
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
