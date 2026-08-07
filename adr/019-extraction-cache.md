# ADR-019: Extraction Cache

**Status:** Accepted (extended to shared source analysis)

## Context

Extraction is the dominant phase of `pmds extract`, and ADR-013 took it as far
as parallelism can: work spread across a bounded pool, not work avoided. On the
realistic benchmark corpus (1,500 files, 6,000 messages), what remains splits
like this:

| Work                      | Cost     |
| ------------------------- | -------- |
| Reading all 1,500 files   | `25 ms`  |
| Parsing and visiting them | `94 ms`  |
| Stat-ing all 1,500 files  | `2.7 ms` |

Profiling found no hotspot to attack: the heaviest single function in our own
code accounts for about 1% of samples, and roughly 40% of a serial run sits in
kernel syscalls. There is no trick left in the parser. The work is real.

But most of it is repeated. Between two `pmds extract` runs a developer has
usually touched a handful of files; the other 1,495 produce exactly the result
they produced last time. Validating that a file is unchanged costs a `stat` —
about a thousandth of what re-deriving its messages costs.

An earlier attempt to avoid work more cheaply was rejected. Skipping the parse
for files with no macro import looks equivalent, but is not: `i18n._(...)`
runtime calls are extracted without any import, so the filter silently dropped
messages until the tests caught it. Corrected, it saved only 119 ms to 98 ms
serial and nothing measurable on the four-worker path, while making broken
non-i18n files stop being reported. On 27 July 2026, that macro-import-only
variant was not in the codebase.

### Later marker-based fast paths (31 July 2026)

A later implementation adopted a broader, deliberately textual candidate gate.
For non-MDX files, the gate treats a source as a parse candidate when its text
contains either `@palamedes` or `i18n`; otherwise it returns no messages or
source diagnostics without parsing. The `i18n` substring is the necessary
correction to an `@palamedes`-only check: supported runtime forms include the
call `i18n._(...)` and the tagged template ``i18n.t`...` ``; neither has a
macro import. This is a substring
check, not a match for an `@palamedes/i18n` import or a claim that the source
is syntactically valid.

The policy appears in three source-analysis paths, whose symbols are the
authoritative definition:

- `extract_one_file` applies it before parsing in batch extraction, which is
  used by `pmds extract` and the native binding.
- `analyze_source_file_cached` applies it while reading an uncached file for
  shared source analysis, including `pmds lint`.
- `analyze_source_in` applies a narrower, post-parse gate: after macro-import
  collection, a file with no imported macro and no `i18n` substring skips the
  remaining AST walks and line-index construction. Parse diagnostics therefore
  remain unchanged on this path.

Batch extraction accepts the diagnostic trade-off that the 27 July alternative
identified: a syntax-broken, marker-free non-MDX file is deliberately skipped
and does not fail extraction. A marker-bearing candidate is parsed and keeps
its normal parse diagnostics. MDX always takes the full path. The behavior is
covered by `batch_skips_broken_files_without_i18n_markers` and
`batch_reports_non_fatal_file_failures` in
`crates/palamedes/src/extract.rs`; the CLI failure behavior for a marker-bearing
file is covered by `extraction_failures_leave_existing_catalogs_unchanged` in
`crates/palamedes-cli/src/commands/extract/mod.rs`.

The scan is intentionally an over-approximation, not a parser. An incidental
`@palamedes` or `i18n` in a comment, string, or unrelated identifier can cause
an otherwise irrelevant file to be parsed; that is a performance false
positive, not extraction evidence. Conversely, supported macro imports and
runtime-call spellings carry one of these substrings, but a future supported
surface that does not would be skipped until this gate is updated. Neither
outcome lets textual scanning establish that a file is valid syntax.

## Decision

Native source analysis keeps a per-file cache of its results, validated by
`stat`. Extraction and source lint share it.

An entry stores the extracted messages, source-authoring diagnostics, and the
origin path for one source file, keyed by absolute path and guarded by size plus
modification time. A compatible hit skips the parse; extraction also skips the
read, while lint still reads the small source text needed to apply inline
suppressions. The cache keeps its established location at
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
- Entries for files no longer in the extraction set are dropped, so a long-lived
  watch process does not grow without bound. Retention runs once over the union
  of every catalog's files; doing it per catalog would make each catalog evict
  the entries of its siblings, so a multi-catalog project would re-extract
  almost everything on every run.

It can be turned off with `--no-cache` on either command or with
`extract-cache: false`.

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

## Consequences

- On the realistic corpus, the warm run drops the extract phase from `60 ms` to
  `5 ms` — including loading the cache and stat-ing every file — and the
  end-to-end median from `125.88 ms` to `70.08 ms`.
- Cold runs pay for it. The same corpus went from `112 ms` before the cache to
  `125.88 ms` with it: roughly `+14 ms`, split between the two `stat` calls per
  file described above, copying the extracted records into the cache map, and
  serializing and writing a ~1.8 MB payload. Directly measured, the second
  `stat` accounts for about `5 ms` of that — cold extraction moves from `60 ms`
  to `65-73 ms`. That is a deliberate trade — every repeat run is
  worth about `-56 ms` — but it is a real regression in the number the website
  quotes, and it is recorded here rather than absorbed quietly. Reducing it
  means avoiding the record copy and using a more compact payload; neither is
  done here.
- Catalog and lint output are unaffected. Cold-with-cache, warm, and
  `--no-cache` runs produce byte-identical results.
- Writing catalogs now dominates the warm run at roughly 40 of 70 ms. The same
  reasoning applies there: if the message set is unchanged the rendered catalog
  is unchanged, and that could be established without re-rendering it. That is
  the next thing worth doing, and it is not done here.
- The project gains an on-disk artifact. `.palamedes/` belongs in `.gitignore`.
- The cache file is roughly the size of the extracted messages plus any emitted
  source diagnostics — about 1.8 MB for the original 6,000-message benchmark.
  Loading it is part of the 5 ms above, so JSON is fast enough to read at this
  scale; writing it is the larger half of the cold cost above, which is where a
  more compact format would pay off first.
- Stale entries are impossible to observe through normal editing, but a tool
  that rewrites a file preserving both size and modification time would defeat
  the check. `--no-cache` exists for that case.
