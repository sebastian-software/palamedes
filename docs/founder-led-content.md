# Founder-Led Content Backlog

This backlog turns real engineering work in Palamedes into outward-facing proof and positioning.

The goal is not “talk about Rust.” The goal is to show why Palamedes feels cleaner, faster, and easier to trust.

## Core Positioning Line

**Palamedes brings Rust-like discipline to JavaScript i18n tooling: fewer legacy branches, clearer semantic ownership, and faster hot paths.**

## First 5 Assets

### 1. Flagship essay

- **Title**: Rust-like discipline for JavaScript i18n tooling
- **Goal**: establish the product philosophy and the difference between “written in Rust” and “architected with discipline”
- **Key message**: Palamedes removes historical branches and duplicate semantics instead of only chasing speed

### 2. Case study

- **Title**: What we delegated to Ferrocat and why
- **Goal**: show that Palamedes got smaller and cleaner by giving catalog semantics a clear owner
- **Key message**: delegation beat bespoke glue for correctness, maintainability, and trust

### 3. Benchmark post

- **Title**: Measuring Palamedes honestly
- **Goal**: support speed claims with reproducible methodology
- **Key message**: the important story is not hype, but visible hot-path wins with exact commands and fixtures

### 4. Migration post

- **Title**: From Lingui to Palamedes without changing how authoring feels
- **Goal**: reduce migration fear
- **Key message**: the visible macro model stays familiar while the tooling stack gets much cleaner

### 5. Principles page

- **Title**: The principles behind Palamedes
- **Goal**: give contributors and advanced adopters a stable frame for why the product feels different
- **Key message**: one identity model, one runtime model, native core, thin adapters, delegated semantics

## Ongoing Micro-Content Stream

Post 1 to 2 short pieces each week. Each post should make exactly one sharp point.

Suggested topics:

- why `message + context` is the only semantic identity
- why JSON is the wrong N-API boundary
- why compiled artifacts should be host-neutral
- why fewer legacy branches is a product feature
- why delegating semantics can make a tool feel more mature, not less
- why “faster” matters less than “clearer ownership”

## Tone Rules

- opinionated
- concrete
- technically specific
- architecture as evidence of product quality
- no generic Rust evangelism

## Suggested Call To Action Pattern

Each long-form asset should end with one concrete next step:

- try the [5-minute quickstart](https://github.com/sebastian-software/palamedes/blob/main/docs/first-working-translation.md)
- review the [proof and benchmark page](https://github.com/sebastian-software/palamedes/blob/main/docs/proof-and-benchmarks.md)
- compare the migration path from Lingui
