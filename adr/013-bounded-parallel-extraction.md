# ADR-013: Bounded Parallel Extraction

**Status:** Accepted

## Context

Extraction dominates the local workflow. On the checked end-to-end benchmark's
realistic corpus (1,500 files, ~400,000 lines, 6,000 messages), reading and
parsing source is about two thirds of `pmds extract`:

| Phase   | Time     |
| ------- | -------- |
| glob    | `7 ms`   |
| extract | `122 ms` |
| write   | `41 ms`  |

Reading and parsing each file is independent work, so this is the one phase in
the CLI with obvious parallelism available.

The obvious implementation — hand the file list to Rayon's global pool — makes
the CLI **slower**. Measured on an M1 Ultra (16 performance + 4 efficiency
cores), extraction time against worker count:

| Workers | 1      | 2     | 4         | 8     | 12     | 20     |
| ------- | ------ | ----- | --------- | ----- | ------ | ------ |
| Time    | 119 ms | 69 ms | **45 ms** | 70 ms | 151 ms | 197 ms |

Rayon defaults to one worker per core, which on this machine is the far right
column: 1.6x slower end to end than not parallelizing at all.

The collapse is not in the extraction work. Running extraction twice inside one
process separates the two costs:

| Workers | First pass | Second pass |
| ------- | ---------- | ----------- |
| 4       | 51-65 ms   | 37-40 ms    |
| 20      | 116-152 ms | 28-42 ms    |

Steady state at twenty workers is the fastest result measured. What does not
scale is a one-time per-process cost that grows with worker count. Profiling
(samply at 10 kHz, symbolicated against `libsystem_kernel`) attributes 92.8% of
samples at twenty workers to `mach_vm_protect` — kernel virtual-memory work
serialized on the process-wide `vm_map` lock — against 56.7% at four.

`pmds extract` is a one-shot process. It pays that setup cost on every
invocation and never reaches the steady state that would repay it.

Several plausible causes were implemented and measured, and none of them
explained the curve: a per-file arena replaced by a thread-local arena reused
with `reset()`; mimalloc as the global allocator; `with_min_len` chunking
against false sharing on the collected results; worker stack sizes from 128 KB
against the 2 MB default; and priming the process with the CLI's glob walk. Only
the worker count moves the number.

This supersedes the earlier decision to defer CLI parallelism entirely. That
decision was correct for what it measured — Node worker threads, where
per-worker startup, source serialization, and native binding initialization
dominated — and it explicitly named measurement as the gate, with a persistent
pool for long-running work as the promising direction. The measurements above
are the native ones it asked for, and they agree with it: naive per-command
fan-out across all cores is the wrong shape.

## Decision

Extraction parallelizes the per-file read/parse pass across a **bounded** pool,
defaulting to **four workers**.

Four is the measured floor of the curve above, not a core count. It is a
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

## Consequences

- On the realistic corpus, the full harness measures the extract phase dropping
  from `122 ms` to `53 ms` and the end-to-end `pmds extract` median from
  `182 ms` to `112 ms`. The smaller profiles gain less in absolute terms
  (medium `10 ms` to `6 ms` of extract, small `3 ms` to `2 ms`), because there
  the write phase dominates.
- Catalog output is unchanged. Equality with serial extraction is covered by a
  test that runs the same corpus at one, two, four, and eight workers and
  compares the aggregated result.
- The default is a measured constant, so it is a claim about one shape of
  workload and machine, not a universal one. It is expected to be revisited when
  the benchmark corpus or the reference hardware changes.
- Pool construction cost is paid per `extract` call. For watch mode, where the
  process is long-lived and the steady-state numbers above apply, a persistent
  pool is a worthwhile follow-up and is not implemented here.
- The `vm_map` contention behind the ceiling is a platform characteristic that
  was observed but not defeated. If a future change removes it, the bound should
  be re-measured rather than assumed.
