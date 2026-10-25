# Ferralk 1.1 adoption

The native CLI uses released Ferralk 1.1.0 for traversal and include/exclude
matching. Extraction and watch mode share `PatternSet` with
`PatternOptions::walker().match_hidden(true)` and the separator-crossing
`is_match` entry point. Globset is no longer a CLI dependency or an alternate
matching mode. This is a pre-v2 pattern-contract change.

## Dependency and toolchain

The [published registry record](https://github.com/rust-lang/crates.io-index/blob/master/fe/rr/ferralk)
and [release manifest](https://github.com/sebastian-software/ferralk/blob/v1.1.0/Cargo.toml)
require Rust 1.96 for Ferralk 1.1.0. The previous CLI used Ferralk 0.5.3;
0.6.1 is the last released version compatible with Palamedes' former Rust
1.95 minimum. The workspace now requires Rust 1.96, with its pinned toolchain,
CI minimum-version lane, and musl build image updated together. Prebuilt npm
native packages still run without local Rust.

Ferralk 1.1's [consumer contract](https://github.com/sebastian-software/ferralk/blob/v1.1.0/docs/consumer-contract.md)
and [release notes](https://github.com/sebastian-software/ferralk/releases/tag/v1.1.0)
describe the new APIs and the syntax differences. The upstream consumer work
in [Ferralk #372](https://github.com/sebastian-software/ferralk/issues/372)
made adoption possible; it did not establish equivalence with Globset.

## Pattern migration

Ordinary `*` still crosses separators, hidden paths remain discoverable, and
directory includes still expand to the supported source extensions. The
intentional differences are:

| Pattern                     | Previous Globset reading | Ferralk reading or migration                                                                    |
| --------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------- |
| `app/@(foo\|bar).ts`        | Literal text             | Selects `foo.ts` and `bar.ts`; escape the punctuation to select a literal extglob-shaped name.  |
| `app/[[:digit:]].ts`        | Does not select `1.ts`   | Selects a digit filename such as `1.ts`.                                                        |
| `app/{,foo}.ts`             | Selects `foo.ts`         | Also selects `.ts`. Use `{foo,bar}.ts` or explicit files when no empty alternative is intended. |
| `src\**\*.tsx` on Windows   | Native separators        | Write `src/**/*.tsx`; `\` now escapes syntax on every platform.                                 |
| Literal syntax in filenames | Globset bracket escapes  | Prefer Ferralk escapes, such as the single-quoted YAML pattern `'app/\[draft\].tsx'`.           |

To match a literal filename `@(foo|bar).ts`, for example, use
`'app/\@\(foo\|bar\).ts'` in YAML. Absolute glob roots supplied in configuration
use the same escaping rules. Palamedes automatically escapes its own project
root and existing directory includes, including bracket, brace, and backslash
characters in directory names.

Leading `!` is not list negation: put exclusions in `exclude`. A path such as
`!app/page.tsx` remains literal, while `!(foo).ts` is an extglob. Custom
excludes replace the default config-root `**/node_modules/**` rule; repeat it
when needed. Use `generated/**` for a subtree, not a bare directory exclude.

Review configured patterns and run `pmds extract --check --fail-on-empty-catalog`
before accepting newly extracted catalogs. The check does not write catalogs.
The [configuration reference](./configuration.md#native-cli-source-patterns)
contains the full current contract.

## Discovery and watch boundaries

Literal include prefixes still determine narrow traversal and watch roots,
including absolute and outside-config roots. A directory symlink explicitly
selected as a root is traversed. Directory symlinks encountered inside a root
are not followed; file symlinks are included only while their target is a file.
Overlapping roots produce one deterministic sorted file list.

Roots end at complete path components: an unrelated `foo/` directory cannot
hide files selected by `foo@(a|b).ts` or `foo*.ts`. Parent components keep their
filesystem meaning and configured reference spelling. For example, if `link`
points to `external/target`, `link/..` scans `external`, with watch aliases
mapping resolved events back to the configured spelling.

The walker visits entries and `PatternSet` filters their absolute paths on the
producing worker. This avoids the walker's absolute-pattern rewrite constraint:
a config-wide wildcard exclude can lie above a narrow include root. Native
`/**` prefix/full-pattern pairs allow safe whole-subtree pruning with
`Verdict::Prune`. Both sides use Ferralk; there is no dialect translation or
legacy matcher. Keeping narrow roots also preserves explicitly included
directory symlinks without following every discovered directory link.

Contract fixtures exercise hidden sources and exclusions, absolute/escaped
roots, outside-config directories and globs, overlapping includes, custom
exclude replacement, malformed include/exclude diagnostics, all symlink kinds,
and extraction/watch event agreement for the new syntax. Windows fixtures
check `/` separators and backslash escapes in the normal cross-platform Rust
CI suite. Unix symlink fixtures require symlink creation privileges and run
on Unix hosts.

## Bounded traversal measurement

This characterization compares the old discovery implementation with the
native matcher on one deterministic fixture. Both binaries use optimized Rust
1.96.1 on the same Apple M1 Ultra, macOS arm64 host, the same default features,
and four discovery threads. The baseline is commit
`8497885319855bef287fc5f1dcc7df9c7e77759c` with only the measurement test added.

The fixture contains 100 feature directories, each with 30 `.tsx` files in
`src`, `.generated`, and `node_modules/dep`: 9,000 files in total. Every sample
must return the exact sorted 6,000-path vector from `src` and `.generated`.
Setup and config loading are outside the timed region; discovery includes
pattern compilation, filesystem traversal, filtering, sorting, and deduplication.

After five warmups, each run records 30 samples. Alternating order is baseline,
native, native, baseline, baseline, native. The per-run medians are:

| Run | Baseline Ferralk 0.5.3 + Globset | Native Ferralk 1.1.0 |
| --- | -------------------------------: | -------------------: |
| 1   |                         5.170 ms |             8.726 ms |
| 2   |                         8.079 ms |             8.556 ms |
| 3   |                         7.630 ms |             8.591 ms |

The median of run medians increases by about 0.96 ms, or 13%, for this
discovery-only fixture. Individual samples range from 4.832–11.053 ms for the
baseline and 5.944–9.254 ms for the native path. Concurrent engineering work
adds noise, and the broad sample overlap does not establish a stable performance
ratio. This is a measured cost accepted for the single-engine contract,
not a speedup claim or a measurement of complete extraction.

[Raw samples and environment](../benchmarks/source-discovery/results/ferralk-1.1.0-macos-arm64.json)
retain every timing and the path oracle. Run the characterization explicitly:

```sh
CARGO_BUILD_JOBS=3 CARGO_INCREMENTAL=0 cargo +1.96 test --release \
  -p palamedes-cli --bin pmds \
  commands::extract::sources::tests::measure_source_discovery \
  --locked -- --ignored --nocapture
```

For a baseline rerun, copy only that ignored test into the existing source-test
module at the baseline commit, keep its runtime code and lockfile unchanged,
and use the identical compiler and command. Fixture creation and correctness
assertions are part of the retained test, and no timing threshold runs in CI.
