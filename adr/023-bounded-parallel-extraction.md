# ADR-023: Bounded Parallel Extraction

**Status:** Accepted

**Last updated:** 2026-10-16

Extraction uses bounded parallel work with deterministic serial aggregation.

## Decision

Extraction parallelizes the per-file read/parse pass across a **bounded** pool,
defaulting to **four workers**.

Four is the measured minimum in the workload described below, not a core count. It is a
constant rather than a function of `available_parallelism()` precisely because
the ceiling is process setup cost, not available compute.

The bound is configurable, because the measurements come from one machine and
one corpus shape:

- `--threads <COUNT>` on `pmds extract`
- `extract-threads` in the config file
- `maxThreads` on the native binding's extract request

Precedence is flag, then config, then the default. Every path is clamped to the
machine's available parallelism and to the file count. `1` forces the serial
path and skips pool creation entirely.

Aggregation stays serial and in input order. `add_extracted_message` appends to
origin lists, extracted comments, and placeholder values, so merge order decides
catalog output order. The parallel pass collects per-file results into an
order-preserving `Vec`; the merge walks it sequentially. Fatal authoring errors
are reported for the first offending file in input order, matching the serial
behavior.

The pool is built per call rather than installed globally. This is a library
used by the CLI and by the Node binding, and a global pool would impose thread
policy on every embedder.

## Context

Per-file reading and parsing can run independently, but maximum parallelism is
not necessarily fastest for a short-lived CLI. One measured 1,500-file workload
on an M1 Ultra took 119 ms with one worker, 45 ms with four, and 197 ms with
twenty. Profiling attributed 92.8% of samples at twenty workers to
`mach_vm_protect`, indicating serialized process setup costs.

These observations justify a bounded default, not a universal throughput claim.
Catalog aggregation also has an ordering constraint: origins, comments, and
placeholder values must merge in input order regardless of worker completion.

## Consequences

- Serial and parallel extraction produce the same aggregated messages and
  deterministic first-failure behavior.
- Each call owns its pool rather than imposing a process-global Rayon policy
  on embedders. Short-lived invocations pay pool startup costs.
- The worker default is revisited against representative workloads and hardware;
  additional cores alone do not justify increasing it.

## Validation And Review Triggers

Tests compare one, two, four, and eight workers on the same corpus. Re-measure
pool construction and steady-state work separately when the default, allocator,
source workload, or supported hardware changes.
