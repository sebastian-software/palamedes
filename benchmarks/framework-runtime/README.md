# Framework runtime experiments, 2026-09-10

Base: `f5112b8fcdda2a5f9d8cb6589d76f3b5756d5f1d` (main, after #1167).
Environment: Chromium 151.0.7922.34, macOS arm64, Apple M1 Pro, Node 24.15.0.

## Workload and limits

The harness builds minified production React and Solid applications with a
native-generated catalog. Each renders 500 `Trans` rows containing interpolation,
a rich-text tag, and an ICU plural. It measures mounting and 40 synchronous
updates after five warmup updates. Each variant gets nine fresh browser contexts;
their execution order alternates between rounds. The complete final text and
500 rendered `strong` elements must match, and browser errors fail the run.

Core, the catalog, and framework dependencies are identical for both variants;
only the React/Solid renderer distributions change. In particular, these results
do not include the separate Core runtime optimization. Compare variants within
one result file, not absolute timings between experiments. These are browser
microbenchmarks, not predictions for whole application performance, other JS
engines, concurrent React scheduling, or server throughput. They ran on a
developer laptop, without CPU isolation or a statistical significance claim.

Heap figures are live V8 heap deltas after forced GC, relative to the loaded
application before mounting. They include framework/JIT bookkeeping and do not
measure allocated bytes, peak memory, native DOM storage, or RSS. After unmount,
the current harness lets cleanup tasks run before forcing GC. A React `WeakRef`
probe also checks whether the last original component element is still reachable;
the i18n instance deliberately stays alive. This probe measures one retention
path, not total heap savings. The Solid zero in this metric means no probe exists.

## Final comparison with main

| Metric                          |  React main | React current |  Solid main | Solid current |
| ------------------------------- | ----------: | ------------: | ----------: | ------------: |
| Mount                           |     16.2 ms |       15.8 ms |     13.8 ms |       13.6 ms |
| 40 updates                      |     52.6 ms |       43.8 ms |     76.8 ms |       68.9 ms |
| Mounted heap delta              | 1,800,128 B |   1,806,720 B | 1,649,760 B |   1,653,616 B |
| After-unmount heap delta        |   621,044 B |     626,336 B |   501,244 B |     501,516 B |
| Original React element retained |    9/9 runs |      0/9 runs |         n/a |           n/a |

[All final samples](results/2026-09-10-final.json) are retained. Update time fell
about 17% for React and 10% for Solid. Mount changes are small; total live heap
does not improve. Removing temporary join arrays is an allocation argument from
the code, not a measured byte-count reduction.

## Decisions and ablations

1. **Keep direct join loops in both renderers.** The previous `flatMap` callback
   allocated a temporary singleton array for every string part. The loop appends
   strings directly and shallow-copies node arrays, preserving sparse-array holes
   being skipped, nested React children, and input immutability. The isolated
   [join-loop run](results/2026-09-10-join-loops.json) changed React updates from
   52.1 to 45.8 ms and Solid updates from 76.0 to 69.0 ms. That early harness did
   not have the WeakRef probe or post-unmount cleanup delay; its heap results
   should not be compared with later result files.
2. **Keep one leased React renderer per i18n instance.** Component names do not
   change the renderer's shape. Remove the component-key enumeration, sorting,
   JSON key, and per-shape Map. Install components for a synchronous render and
   clear them in `finally`, including thrown custom renderers. A nested render
   receives a temporary renderer so it cannot overwrite outer components or
   element keys. This preserves hook-free React Server Component support. The
   [reuse ablation](results/2026-09-10-runtime-reuse.json), against join loops
   alone, changed updates from 46.4 to 45.3 ms: a small timing difference, not
   the main justification. The stronger evidence is the retention probe changing
   from 9/9 retained elements to 0/9, a bounded cache independent of component
   shapes, and regression tests for reentrancy and exceptional cleanup.
3. **Defer the additional Solid runtime cache.** The same reuse experiment
   reduced Solid updates from 70.0 to 64.2 ms (8%), but raised mounted live heap
   by 22,612 B (about 1.4%) for 500 rows. It requires per-instance locale,
   timezone, and i18n-identity invalidation plus lazy component access. The extra
   speed is real in this sample, but we keep the smaller join change for now
   rather than add retained state and reactivity complexity to every `Trans`.
   The [experimental patch](experiments/2026-09-10-solid-runtime-cache.patch)
   is preserved for a production workload that justifies this tradeoff. It is
   excluded from the runtime and final measurements.

## Reproduction

Build main in a separate checkout, then copy its complete `packages/react/dist`
and `packages/solid/dist` directories to `baseline/react` and `baseline/solid`.
Build the candidate checkout and run:

```sh
node scripts/benchmark-framework-runtime.mjs /absolute/path/to/baseline
```

The harness requires the workspace dependencies, built `core-node`, Core and
runtime packages, and the Playwright Chromium browser. It creates and removes
its temporary bundles automatically; no application server is required.

For a join-only baseline, apply just the `join` changes to main's two
`transShared.tsx` files and build/snapshot those distributions. Compare the full
React candidate against that snapshot to isolate React leasing. Applying the
Solid experiment patch to this PR and rebuilding reproduces the Solid cache
candidate against the same join-only baseline. Always keep Core identical for
both variants.
