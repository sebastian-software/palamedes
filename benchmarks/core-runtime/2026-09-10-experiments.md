# Runtime lookup experiments, 2026-09-10

**Historical experiment:** the last-used Intl formatter design below was
subsequently replaced by locale buckets after testing mixed table formats.
See [the revised comparison and decision](2026-09-10-locale-buckets.md).
The original measurements remain here for traceability.

Base: `f5112b8fcdda2a5f9d8cb6589d76f3b5756d5f1d` (main, after #1167).
Environment: Chromium 151.0.7922.34, macOS arm64, Apple M1 Pro, Node 24.15.0.
Each comparison alternates variants across nine fresh contexts. Timings are
medians for 300,000 calls after 10,000 warmup calls. See the parent README for
the import, forced-GC, and checksum methodology.

## Decisions

1. **Keep one last string runtime per instance.** Compared with main, the
   [cache-only experiment](results/2026-09-10-cache.json) reduced interpolation
   time from 54.2 to 44.3 ms (18%). It replaces a Map and per-call composite key
   with a direct reference and locale check, and retains at most one runtime.
   A locale change rebuilds lazily; returning to a previous locale is supported.
2. **Reject the additional direct compiled-function dispatch.** Against the
   cache-only variant, the [direct-call experiment](results/2026-09-10-direct.json)
   changed interpolation from 42.4 to 41.7 ms (about 2%) and plural from 216.5 to
   218.0 ms. This is not a persuasive benefit for widening the render pipeline's
   input type and adding deferred error-resolution logic. The prototype is
   preserved as [a non-production patch](experiments/2026-09-10-direct-call.patch).
3. **Initially keep last-used number/plural formatter references (superseded).** The existing bounded
   Maps remain the source of reusable Intl objects. Small last-used slots avoid
   composite keys on repeated formats. Separate scalar fields avoid allocating
   a cache-entry wrapper when styles alternate. No formatter is created eagerly
   and no formatted output or user values are retained.
4. **Defer compiler function deduplication.** An opportunity scan of the 82
   tracked example PO catalogs (2,050 messages, 643 emitted functions) found
   zero identical arrow-function expressions within a module. These are small
   examples, not representative production catalogs, and this scan does not
   detect more advanced structural equivalence. It nevertheless supplies no
   evidence for adding compiler bookkeeping now. Reproduce with
   `node scripts/inspect-catalog-function-duplicates.mjs` after building.

## Final comparison with main

The final harness also adds three generated messages that alternate integer,
percent, and EUR currency formatting. This exercises last-used-slot misses, not
just repeated-format hits. There are 30,003 messages in this comparison.

| Metric                                  |      Main | Runtime + Intl slots |
| --------------------------------------- | --------: | -------------------: |
| Additional retained heap after `load()` | 795,512 B |            795,512 B |
| Catalog `load()`                        |   10.3 ms |              10.1 ms |
| Constant lookups                        |    6.0 ms |               6.1 ms |
| Interpolation lookups                   |   51.9 ms |              42.4 ms |
| Plural lookups                          |  226.4 ms |             193.3 ms |
| Alternating number formats              |  115.9 ms |             106.0 ms |

[All final samples](results/2026-09-10-runtime-and-intl.json) are retained.
Interpolation improved about 18%, plurals 15%, and alternating number formats
9% in this workload. There is no meaningful constant-lookup or load improvement,
and no claim of additional catalog-memory savings. Cross-run timing changes
show why comparisons use interleaved variants within a run rather than comparing
absolute timings from different experiment files.

These results cover Core calls, not whole application rendering or other JS
engines. Runs used a developer laptop without CPU isolation; the medians are
descriptive measurements, not a statistical significance claim.
After-load heap excludes later Intl initialization and is not an Intl
memory measurement. The retained-state argument is structural: one string
runtime per instance; number/plural slots point at the most recently accessed
entries in the existing 64-entry caches.

## Reproduction

Build main's Core package in a separate checkout and copy its complete `dist`
directory. Build the current checkout, then run:

```sh
node scripts/benchmark-core-runtime.mjs /absolute/path/to/main-core-dist
```

For the historical ablations, use the harness at base `f5112b8f` (the original
30,000-message corpus). The cache-only candidate is the base with just the
`i18nRuntime.ts` change from this PR. Build and snapshot that candidate, apply
`benchmarks/core-runtime/experiments/2026-09-10-direct-call.patch` from the repository root, rebuild, and
compare against the cache-only snapshot. The rejected patch is an experiment,
not part of the shipped runtime.
