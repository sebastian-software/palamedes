# Formatter caches under alternating table formats

This comparison replaces the last-used-formatter proposal in
[the earlier experiment](2026-09-10-experiments.md). That experiment's 9% mixed
number improvement combined a string-renderer optimization with formatter-cache
changes; it did not isolate a benefit from the last-used formatter itself.

## Four controlled variants

- **Main:** `f5112b8fcdda2a5f9d8cb6589d76f3b5756d5f1d`.
- **Runtime only:** Main with only the single string-renderer change in
  `i18nRuntime.ts`. Number/plural caches still use composite string keys.
- **Last formatter:** initial PR #1201, commit
  `198aff8b41010b56c6f8ccf99c96d5cac37a59a1`.
- **Locale bucket:** the revised PR. It keeps the single string renderer and
  replaces last-used number/plural formatters with a Map of formats per locale.
  A direct reference to the active locale's Map avoids looking up that locale
  again while it remains unchanged. Style changes still hit that Map.

All variants use identical dependencies, native-generated catalog code, and
input values. Each variant gets nine fresh Chromium contexts. The first variant
rotates between rounds and alternate rounds reverse their order. Reported values
are medians. All samples are in
[the raw result file](results/2026-09-10-locale-buckets.json).

Environment: Chromium 151.0.7922.34, Node 24.15.0, macOS arm64 / Apple M1 Pro.
This is a developer-laptop measurement without CPU isolation or a statistical
significance claim.

## Table-shaped workload

The fixture has 1,000 precomputed rows with different numeric values per row and
column. Its five supported number formats are EUR currency, integer, percent,
default decimal, and USD currency. No random-number generation or values-object
allocation occurs inside the timed loops.

Each case warms up with 10,000 message calls before measurement:

- **Repeated currency:** 300,000 calls using one format; favorable to the old
  last-formatter optimization.
- **Table cells:** 300,000 calls cycling through all five columns, row by row.
  Consecutive calls never use the same format.
- **Shuffled cells:** 300,000 calls using a seeded, reproducible style sequence.
  All five styles are equally represented, including occasional consecutive hits.
- **Whole rows:** 60,000 calls to a generated message that formats all five
  columns: 300,000 number-format operations with fewer Core lookups. This helps
  separate formatter improvements from string-renderer lookup improvements.
- **Alternating locales:** 300,000 cells using three separate i18n instances
  (`en-US`, `de-DE`, `fr-FR`) in rotation. A stress case for shared caches under
  interleaved requests, not the expected browser-document locale pattern.
- **Plural:** 300,000 plural messages with varying counts and pound formatting.

Exact number and whole-row outputs are checked against Intl for three rows in
each locale. All timed output-length checksums must agree across variants, and
browser errors fail the run. Probes also warm the formatters before timing.

| Time (ms)           |  Main | Runtime only | Last formatter | Locale bucket |
| ------------------- | ----: | -----------: | -------------: | ------------: |
| Repeated currency   | 125.7 |        116.0 |           92.8 |          97.5 |
| Table cells         | 127.0 |        115.0 |          117.0 |          98.8 |
| Shuffled cells      | 125.6 |        118.0 |          114.7 |         102.4 |
| Whole rows          | 118.7 |        116.6 |          116.8 |         101.6 |
| Alternating locales | 139.5 |        126.3 |          126.9 |         108.3 |
| Plural              | 211.8 |        197.7 |          170.1 |         176.6 |

**Decision:** replace last-used formatters with locale buckets. Compared with
the runtime-only control, the additional formatter change reduces table-cell
time by about 14%, shuffled-cell time by 13%, and whole-row time by 13%.
The last-formatter design does not help cyclic table cells or whole rows.

This is a tradeoff: locale buckets are about 5% slower than last-formatter slots
for repeated currency and 4% slower for the plural case. We accept those costs
for a design that handles changing formats and interleaved locales consistently.
These cases model access patterns; they are still synthetic Core workloads, not
production traces, DOM rendering, first-render measurements, or overall app speed.

## Is the composite string key the cause?

Separate lookup-only controls use the same five styles and consume every result.
They perform 3,000,000 lookups after 100,000 warmup calls in each of nine fresh
pages, with rotated case order. There is no Intl formatting or Core renderer work.

| Lookup-only control                                            |   Median |
| -------------------------------------------------------------- | -------: |
| Build `locale + separator + style`, then look up in a flat Map | 122.4 ms |
| Reuse precomputed composite keys with that same flat Map       |  24.7 ms |
| Look up locale, then style in nested Maps                      |  32.7 ms |
| Look up style in an already selected locale Map                |  23.8 ms |

The composite-key path matters in this control: approximately 41 ns per lookup
versus 8 ns with precomputed keys. That is cheap in absolute terms, but repeats
for every format operation. This does **not** separate string construction from
string hashing/comparison, allocation/GC, or JIT effects. Nor does it establish
that Map lookup itself is generally slow. The whole-message measurements above
are the evidence for changing the production cache.

## Memory and complexity

The new helper shares one eviction policy between number and plural caches, with
independent instances for each. Each cache still retains at most **64 formatters
in total across all locales**, not 64 per locale. FIFO bookkeeping runs only on
insertion; empty locale buckets are removed. Failed constructors do not insert
entries or evict valid ones. The active bucket references entries in that same
bound, and holds no formatted values or output strings. Date/time caching is
unchanged.

Nested Maps and insertion records add metadata compared with the old flat Map.
No total-heap reduction is claimed or measured here. Tests exercise format and
locale alternation, global eviction, emptied-bucket reuse, undefined keys, and
construction failures. The extra bookkeeping is accepted for the measured gains
on mixed-format access rather than increasing the retained Intl-object budget.

## Reproduction

Build complete Core `dist` snapshots for the four variants listed above using
the same lockfile. For the runtime-only snapshot, use main and replace only
`packages/core/src/i18nRuntime.ts` with its version from `198aff8b` before building.
The original last-formatter change is also retained as
[an excluded experimental patch](experiments/2026-09-10-last-formatter.patch)
which applies to that runtime-only source tree.

After installing workspace dependencies, building `core-node`, and installing
Playwright Chromium, run from the revised checkout:

```sh
node scripts/benchmark-formatter-cache.mjs \
  main=/absolute/main-core-dist \
  runtimeOnly=/absolute/runtime-only-core-dist \
  lastFormatter=/absolute/initial-pr-core-dist \
  localeBucket=/absolute/revised-core-dist
```

The script serves local files through Playwright request interception. Its JSON
contains every whole-message sample and the separate lookup-only controls.
