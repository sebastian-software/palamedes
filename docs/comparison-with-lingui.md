# Palamedes vs. Lingui

Palamedes is not trying to be a universal rebuttal to Lingui. It is a focused
path for teams that already like macro-based i18n and want the stack underneath
to feel smaller, steadier, and easier to trust.

If you want the broader architectural comparison, including `next-intl` and
General Translation, read [Comparing Modern i18n Approaches](https://github.com/sebastian-software/palamedes/blob/main/docs/approach-comparison.md).

The real difference is not "Rust vs. JavaScript." It is the end state:

- one runtime model
- one message identity model
- small host adapters
- catalog and ICU semantics owned in one place

## Short Answer

Choose Palamedes if you want:

- faster transforms and extraction
- a calmer migration target than Lingui's broader historical API surface
- source-string-first catalogs with `message + context`
- a stack that is easier to reason about over time
- one runtime model that stays stable across verified framework integrations
- a local foundation that can support managed translation layers later without giving up repo ownership

Stay on Lingui if you want:

- maximum compatibility with the existing Lingui ecosystem
- the most established docs/community surface today
- the broadest accommodation of older patterns

## Outcome-First Comparison

| Topic | Lingui | Palamedes |
| --- | --- | --- |
| Authoring feel | Familiar macro-based i18n | Intentionally familiar macro-based i18n |
| Dev/build work | Historically more JS/Babel-shaped | Rust core + OXC + small adapters |
| Message identity | Broader historical surface | Strictly `message + context` |
| Runtime model | More than one historical access path | One public model: `getI18n()` |
| Catalog semantics | Mixed legacy and ecosystem pressure | Source-first with `ferrocat` underneath |
| Future translation layering | Usually solved outside the core | Local catalog and QA foundation |
| Long-term shape | Broad compatibility pressure | Opinionated, narrower, easier to trust |

## Why The End State Gets Cleaner

### 1. The runtime model

Palamedes standardizes on `getI18n()` across the framework surfaces it verifies.

That sounds small, but it removes a lot of ambiguity:

- fewer special cases between environments
- clearer transform output
- less runtime API sprawl

### 2. Message identity

Palamedes treats `message + context` as the public identity.

That means:

- no author-facing explicit IDs
- source-string-first catalogs
- cleaner diagnostics
- less identity drift between authoring, extraction, and catalog compilation

### 3. Semantic ownership

Palamedes deliberately delegates catalog semantics to `ferrocat` instead of
carrying duplicate PO logic in multiple layers.

That makes the system easier to trust:

- less bespoke glue
- clearer ownership boundaries
- fewer duplicated semantics between core and adapters

### 4. The adapter boundary

Palamedes keeps host adapters thin.

The core compiles host-neutral artifacts. The host adapters render what they
need on the adapter side. That separation is part of the product, not an
implementation accident.

## Why That Matters Beyond Migration

The story reaches beyond Lingui migration.

It is also a story about what happens when a team wants the same i18n mental
model to survive across different application shapes and framework decisions.

That matters because:

- teams do not want framework-specific i18n glue to own semantics
- architecture cleanup gets easier when the runtime and identity model stay stable
- a cleaner local foundation is easier to extend into future translation workflows

## What Gets Faster

Palamedes is designed to speed up the parts of the workflow that hurt most in
real projects:

- macro transforms
- message extraction
- catalog update and compile steps

Native code helps, but the larger performance story is simpler: Palamedes
carries fewer layers and fewer historical compatibility branches through the
work developers feel every day.

See the benchmark and proof material here:

- [Proof, benchmarks, and current maturity](https://github.com/sebastian-software/palamedes/blob/main/docs/proof-and-benchmarks.md)
- [Benchmarking against Lingui v6 Preview](https://github.com/sebastian-software/palamedes/blob/main/docs/benchmark-lingui-v6-preview.md)

## Who Should Switch Now

Palamedes is a better default if:

- you are starting a new codebase or doing architecture cleanup
- you already like Lingui-style authoring
- you care about toolchain discipline more than feature count
- you want a cleaner stack that can stay coherent across framework boundaries

## Who Should Probably Wait

Stay on Lingui for now if:

- you need the broadest compatibility with older Lingui paths
- you are not willing to remove explicit authoring IDs
- you want the most established ecosystem surface today more than the cleanest architecture

## The Real Positioning

Lingui got the core instinct right early: macros, extracted catalogs, and
pragmatic framework integration are better than ad hoc translation sprawl.

Palamedes keeps that instinct and makes the underlying system smaller and
easier to understand.

It also creates a cleaner base for future translation products that need local
catalog and QA semantics without re-implementing them in a parallel stack.

That is the best way to think about the project:

**Palamedes brings the discipline of a native catalog engine to JavaScript
i18n: fewer legacy branches, clearer ownership, faster daily workflows, and a
translation model that keeps working across frameworks.**

## Continue Here

- [First working translation in 5 minutes](https://github.com/sebastian-software/palamedes/blob/main/docs/first-working-translation.md)
- [Migration from Lingui to Palamedes](https://github.com/sebastian-software/palamedes/blob/main/docs/migrate-from-lingui.md)
- [Benchmarking against Lingui v6 Preview](https://github.com/sebastian-software/palamedes/blob/main/docs/benchmark-lingui-v6-preview.md)
- [Comparing modern i18n approaches](https://github.com/sebastian-software/palamedes/blob/main/docs/approach-comparison.md)
