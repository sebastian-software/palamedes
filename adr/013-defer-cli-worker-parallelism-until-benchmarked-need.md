# ADR-013: Defer CLI Worker Parallelism Until Benchmarked Need

**Status:** Accepted
**Date:** 2026-04-30

## Context

Lingui 6 introduced worker-thread parallelism for CLI operations such as extraction and compile tasks.

Palamedes has a different performance profile:

- macro transform and extraction hot paths are native/Rust-first or OXC-backed
- catalog operations are intentionally narrow and deterministic
- the project positions performance as an architectural outcome, not as a reason to add incidental runtime complexity

A naive `--workers` implementation could split files across Node.js worker threads, but that also adds costs:

- worker startup overhead
- source serialization or transfer overhead
- native binding initialization per worker
- more complicated diagnostics and error ordering
- more complicated watch-mode state
- a broader CLI surface that must be supported long term

A quick parse-only experiment on the existing synthetic benchmark corpus did not show a benefit from spawning workers per run:

- medium profile: 400 files / 4,000 messages / ~561 KB source
  - serial OXC parse median: ~8.9 ms
  - 2 workers: ~25.7 ms
  - 4 workers: ~25.6 ms
  - 8 workers: ~40.7 ms
- large profile: 1,200 files / 12,000 messages / ~1.68 MB source
  - serial OXC parse median: ~26.8 ms
  - 2 workers: ~35.9 ms
  - 4 workers: ~32.1 ms
  - 8 workers: ~45.8 ms

This was not a full native extraction benchmark because the local machine running the experiment did not have `cargo` available to rebuild the native package. It is still useful as a directional check: parsing is a major part of the per-file hot path, and worker overhead dominated at current synthetic corpus sizes.

## Decision

Palamedes will not add CLI worker-thread parallelism by default now.

The CLI should keep the serial extraction path as the primary implementation until a representative benchmark demonstrates that worker parallelism materially improves end-to-end extraction or catalog update time.

A future worker implementation is acceptable only if it is justified by measurement and keeps the public model simple. Good candidates would be:

- a persistent worker pool for long-running watch mode
- coarse-grained catalog or locale parallelism where serialization cost is low
- large monorepo workloads that exceed current benchmark sizes by enough to amortize worker overhead

A naive per-command worker fan-out should not be added merely because another tool exposes `--workers`.

## Consequences

- Palamedes avoids adding concurrency complexity before it has evidence of user-visible benefit.
- Benchmarking remains the gate for CLI parallelism.
- The performance story stays focused on a fast native/OXC hot path first.
- If workers are revisited, the benchmark should measure full end-to-end extraction/catalog update behavior, not just isolated parsing.
- Documentation and roadmap discussions can point to this ADR instead of re-opening the same design question casually.
