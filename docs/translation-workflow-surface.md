# Translation Workflow Surface

This document describes the local translation-support surface Palamedes should provide as a reusable substrate for higher-order products such as Palamedes+.

For the first concrete module split, see [Translation Module Boundaries](./translation-module-boundaries.md).

## Purpose

Palamedes should make it unnecessary for downstream translation products to rebuild repo-local catalog semantics, QA primitives, and metadata handling in parallel stacks.

The goal is not to make Palamedes itself a hosted translation product. The goal is to provide the local workflow substrate cleanly.

## What belongs in Palamedes

### Catalog targeting

- select missing entries
- select targeted entries for re-run or retry
- preserve normal PO update semantics

### Context packaging inputs

- `msgctxt`
- extracted comments
- file or origin metadata where relevant
- other host-neutral hints derived from catalogs or extraction output

### Glossary and protected-term support

- glossary schema loading
- protected-term list loading
- matching helpers for candidate preparation and QA

### Deterministic QA primitives

- placeholder and ICU integrity
- whitespace and structural checks
- glossary and protected-term checks
- review-oriented issue models

### PO metadata helpers

- parse and format compact per-entry metadata
- short hash support for stored translation values
- stale-metadata detection

### Report model

- flagged and unresolved item shapes
- issue aggregation
- batch or locale-level reporting structures

### Orchestration helpers

- bounded concurrency primitives
- batch shaping helpers
- retry-oriented local decision support

These helpers belong in Core only when they stay host-neutral and do not depend on account or provider concerns.

## First implementable module split

The first recommended module map is:

- `translation_candidates`
- `terminology`
- `qa`
- `po_metadata`
- `reports`
- `workflow`

Those module boundaries are described in more detail in the follow-on module document so a Rust implementation does not have to invent the split from scratch.

## What belongs outside Palamedes

- remote translation execution
- model/provider routing
- account, usage, or billing logic
- premium policy packs
- hosted review, audit, or collaboration surfaces

Those concerns are product-layer responsibilities.

## Design rules validated by practice

- Keep prompts small and durable.
- Prefer machine-readable control layers over endlessly growing prompt examples.
- Separate glossary terms, protected terms, deterministic QA, and retry hints.
- Prefer targeted retry to whole-locale reruns.
- Prefer bounded concurrency to naive "everything at once".
- Write catalog updates incrementally when workflow products need resilience.
- Treat unresolved as review routing, not binary failure.

## Intended relationship to Palamedes+

The target split is:

- **Palamedes**: local Rust-first substrate
- **Palamedes+**: remote translation product

Palamedes+ should be able to use this workflow surface without re-implementing the underlying local semantics in a separate stack.
