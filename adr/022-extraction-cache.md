# ADR-022: Extraction Cache

**Status:** Accepted

**Last updated:** 2026-10-16

Extraction and lint reuse compatible source analysis through an advisory cache with conservative invalidation.

## Decision

Native source analysis keeps a per-file cache of its results, validated by
`stat`. Extraction and source lint share it.

An entry stores the origin path and either a complete source analysis or the
extraction-only sentinel for marker-free files, keyed by absolute path and guarded by
size plus modification time. A compatible complete hit skips the parse;
extraction also skips the read, while lint still reads the small source text
needed to apply inline suppressions. A compatible sentinel is reusable only by
extraction. The cache keeps its established location at
`.palamedes/extract-cache.json` under the project root and is written atomically
through a temporary file.

Validation is deliberately `stat`-based rather than content-hashed. Hashing
requires reading the file, which is the cost being avoided.

The same cache serves all three shapes of use. `pmds extract` and `pmds lint`
load, use, and save it, so either command can reuse a compatible analysis
produced by the other. Watch mode loads it once and holds it for the life of the
process, so every rebuild after the first skips unchanged files without touching
disk for them.

The cache is advisory in the strongest sense: a missing, unreadable, corrupt,
or differently-stamped file, an unwritable directory, a failed save — none of
these are errors. They degrade to a normal extraction. A cache that cannot be
trusted is simply not used.

Correctness rests on discarding aggressively rather than reasoning cleverly:

- A stamp covering the schema version, extractor version, source reference
  root, reference-scope behavior, MDX options, and source-rule levels is
  compared on load. Any mismatch discards everything. The extractor version
  matters because a release can legitimately change what a given file produces;
  the remaining fields determine stored origins, messages, or diagnostics.
- The file identity is captured before the contents are read and re-checked
  before the entry is stored; if it moved in between, the file is not cached.
  Storing the identity observed only after extraction would pair the contents
  that were read with the metadata of an edit that landed during the run, and
  the next run would accept that as a hit and write stale messages. This costs a
  second `stat` per freshly extracted file.
- Files modified within one second of being cached are never stored. Their
  modification time cannot be distinguished from an edit landing immediately
  afterwards — the hazard Git documents as racy timestamps. Nanosecond
  timestamps make the window small; refusing to cache closes it.
- Read failures and fatal JS/TS parse or authoring failures are never cached, so
  they are retried on the next run rather than remembered as broken. Structured
  MDX diagnostics are a successful analysis result and are cached; extraction
  still treats them as a failed source file, while lint reports their ranges.
- Marker-free batch-extraction results use an extraction-only sentinel. It is a
  valid empty result for extraction but never a source-lint hit; the first full
  analysis replaces it with messages, diagnostics, and comments.
- Entries for files no longer in the extraction set are dropped, so a long-lived
  watch process does not grow without bound. Retention runs once over the union
  of every catalog's files; doing it per catalog would make each catalog evict
  the entries of its siblings, so a multi-catalog project would re-extract
  almost everything on every run.

It can be turned off with `--no-cache` on either command or with
`extract-cache: false`.

## Context

Repeated extraction and lint runs mostly revisit unchanged source files.
Avoiding their reads and parses is more useful than repeatedly accelerating
that same work. A stat-based cache saves file I/O, at the cost of conservative
invalidation and a deliberate limit: edits preserving both size and modification
time cannot be detected without disabling the cache.

Extraction and lint prove different things. Batch extraction may skip marker-free
non-MDX files, while lint still needs complete parser diagnostics and suppression
comments. A reusable cache entry must preserve that distinction.

## Benchmark Consequences

A cache changes what the benchmark measures, and the change is not benign.

The harness generates its source corpus once per profile and never modifies it.
A cache surviving between runs would therefore be hit by every run after the
first, and the published cold medians would quietly become warm ones — the
speedup ratios the website quotes would become fiction without a single line of
the report looking different. The harness resets tool caches alongside catalogs
before every cold run. That reset is a correctness requirement of this ADR, not
a detail of the harness.

The repeat run is nevertheless worth reporting, because it is what developers
actually experience. The report has a second lane: catalogs reset, caches kept,
a few source files touched to model an edit.

The two lanes answer different questions and are kept apart. Cold is the
like-for-like comparison — same work, every tool — and is the only lane that
feeds the speedup table and the figures the website quotes. Warm is a capability
comparison: Palamedes reuses a cache, the other tools have no comparable local
one and re-extract in full, so their two numbers are identical by design.
Folding warm results into the speedup ratios would produce a large number that
means "we have a feature they lack" while reading as "we do the same work
faster". The report states this in place.

## Source Candidate Gates

Batch extraction parses non-MDX files whose text contains `@palamedes`, `i18n`,
or `palamedes-lint-`. The `i18n` marker preserves direct runtime calls and
`palamedes-lint-` preserves suppression comments. MDX always takes the full
path. Marker-free files yield an extraction-only sentinel, which lint cannot
reuse as a complete analysis.

The gate is a conservative textual candidate check, not a syntax validator.
Incidental markers cause harmless extra parsing. Syntax errors in marker-free
non-MDX files are deliberately not extraction failures. Marker-bearing files
retain parse diagnostics. Shared lint analysis uses its post-parse gate and
keeps parser diagnostics intact. A new supported authoring form must update
these gates if it can lack the current markers.

## Consequences

- Cold runs pay for file stamps, entry copies, and cache persistence; repeated
  runs reuse compatible analysis. Exact results belong in the checked
  [workflow reports](../benchmarks/e2e-workflow/results/latest.md).
- Catalog and lint output must match cold, warm, and `--no-cache` runs.
- `.palamedes/` is generated local state and belongs in `.gitignore`.
- Cache schema or extractor behavior changes invalidate stored analysis rather
  than requiring a migration.

## Validation And Review Triggers

Cache tests cover stamp invalidation, racy writes, extraction-only entries,
shared lint analysis, and multi-catalog retention. Revisit the cache identity or
persistence format when correctness requirements, filesystem behavior, or
measured cold-run overhead change.
