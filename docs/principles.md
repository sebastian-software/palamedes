# Palamedes Principles

These are the product principles that shape Palamedes today.

They matter because the point of Palamedes is not only raw speed. It is a cleaner long-term i18n stack for JavaScript and TypeScript applications.

## 1. Source Strings Come First

Palamedes treats `message + context` as the public identity.

That keeps authoring, extraction, diagnostics, and catalogs aligned with gettext-style semantics instead of splitting identity across multiple public concepts.

## 2. One Runtime Model

The public runtime model is `getI18n()`.

That keeps the actual question explicit: where does the active i18n instance come from in this environment?

## 3. Native Core, Thin Adapters

The core semantic work belongs in Rust. Framework adapters should stay thin.

That means:

- less duplicated logic
- less drift between layers
- clearer ownership of semantics

## 4. Delegate Semantics, Do Not Duplicate Them

Palamedes uses `ferrocat` for catalog and ICU semantics instead of carrying bespoke PO glue in multiple places.

That is a product decision, not only an implementation detail.

## 5. Host-Neutral Artifacts, Host-Specific Rendering

The core compiles host-neutral catalog artifacts. Vite and Next.js render what they need on the adapter side.

That keeps the core portable and the adapter responsibilities obvious.

## 6. Fewer Legacy Branches Is A Feature

Palamedes is opinionated on purpose.

It prefers:

- fewer overlapping runtime paths
- fewer compatibility shims
- fewer historical API branches

That makes the product narrower, but easier to trust.

## 7. Rust Is Evidence, Not The Headline

The point is not “this is written in Rust.”

The point is that Palamedes applies Rust-like discipline to JavaScript i18n tooling:

- clear boundaries
- strong ownership
- fewer duplicated semantics
- faster hot paths

## 8. Keep Translation Control Surfaces Separate

When Palamedes grows translation-support primitives, it should not collapse every quality concern into one layer.

Keep separate:

- request-shaping behavior
- glossary and domain terminology
- protected names and standards
- deterministic QA
- retry hints and review routing

That separation keeps the system easier to evolve and harder to overfit.

## 9. Reviewability Beats Blind Automation

The goal is not "zero unresolved at all costs."

The better default is:

- detect structural risk deterministically
- retry only what deserves another pass
- make review needs visible in reports and catalog artifacts
