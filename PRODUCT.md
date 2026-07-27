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
checked-in benchmarks, and ADRs — rather than telling slogans. Success: a
visitor trusts the engineering within one scroll and reaches the 5-minute
quickstart.

## Product And Marketing Narrative

This file is the concise, current context for product and marketing work. The
durable scope and positioning decision, including its rationale and review
triggers, lives in
[ADR-001](adr/001-project-scope-and-positioning.md).

Palamedes documents that reasoning in the open. Page-specific positioning notes
under `docs/site/` connect individual surfaces to product boundaries and proof
assets; they do not define a second general storyline.

The public narrative follows one spine:

1. i18n semantics often fragment across authoring, catalogs, runtime, and host
   wiring.
2. Palamedes keeps one opinionated model coherent from TypeScript source to
   runtime.
3. A native toolchain and first-party adapters cover the full local workflow
   without giving every concern several competing APIs.
4. The framework matrix, CI flows, benchmarks, and ADRs make those claims
   inspectable.
5. Palamedes+ may add managed automation and collaboration later; Palamedes
   remains useful without it.

## Brand Personality

Precise, verifiable, calm. The visual voice is a **"Swiss Spec Grid"**: a
technical spec sheet / ledger aesthetic. Paper-white ground (`#fbfbf8`), near
black ink (`#101010`), one electric blue accent (`#0038ff`), hairline rules
that separate but never decorate, mono uppercase micro-labels, tabular
numbers, terminal green/amber reserved for CLI output. Hard rules: zero
border-radius, zero box-shadow, zero gradients. Confidence comes from
evidence density and typographic discipline, not visual loudness.

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
3. **One accent, spent deliberately.** Blue `#0038ff` marks interaction and
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
- Keyboard-reachable nav and search; visible focus states in the accent blue.
- Content readable without JavaScript where prerendering allows.
