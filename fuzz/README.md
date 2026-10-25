# Native fuzzing

The three targets mutate bytes at the existing native boundaries:

- `source`: `analyze_source` and `extract_messages`, each in TS, TSX, and MDX mode.
- `config`: the CLI's YAML parser, key checks, deserialization, and semantic
  validation. Path resolution and normalization are excluded so generated input
  cannot select filesystem operations.
- `plugin`: the SDK's typed request decoder and the host's bounded line reader
  and event decoder. No request is dispatched and no plugin is executed.

Expected parse errors and source diagnostics are successful outcomes. Panics,
address-sanitizer findings, timeouts, and memory-limit exits fail the campaign;
there is no panic recovery. The CLI's private modules are compiled directly into
these targets, rather than copied or exposed as public SDK APIs.

## Reproduce

On Linux or macOS, install a C++ compiler and the pinned toolchain:

```sh
rustup toolchain install nightly-2026-07-20
cargo install cargo-fuzz --version 0.13.2 --locked
node scripts/fuzz-native.mjs smoke
node scripts/fuzz-native.mjs scheduled
```

The independent `fuzz/Cargo.lock` pins the fuzz dependency graph. The runner
fetches it with `--locked`, builds offline, and refuses to run if the lock changes.
This nightly is only for sanitizer instrumentation; the normal workspace stable
and MSRV gates remain in the main CI workflow.
The separate fuzz dependency graph also passes the repository's cargo-deny
policy in CI. Its LLVM libFuzzer license exception is scoped to `libfuzzer-sys`.

Every target uses one worker and seed `1311`, with a fresh copy of checked-in
seeds, a 64 KiB input cap, a 5-second per-input timeout, a 2 GiB RSS limit, and a
256 MiB single-allocation limit. The PR smoke budget is 1,000 executions or 20
seconds per target; the scheduled/manual budget is 1,000,000 executions or 300
seconds per target, whichever comes first. The runner also kills a target after
its time budget plus 15 seconds, and caps the instrumented build at 20 minutes.
The CI job has a 45-minute ceiling including tool installation. These are test
budgets, not production limits. Exact mutation order is reproducible with the
same toolchain, platform, seed, and starting corpus; wall-time cutoffs can stop at
different execution counts.

`seeds/` includes backend source/config fixtures, macro/JSX/MDX inputs, all four
plugin event kinds, typed requests, invalid UTF-8, Unicode, truncation, and deep
nesting around the JSON decoder's recursion limit. Seed files retain malformed
syntax. Normal CLI regression tests cover stdout line/total-byte/event limits;
the fuzz target also uses the production line reader without spawning processes.
The line reader's 1 MiB production boundary is checked by a normal unit test,
since generated inputs are intentionally capped below it.

Mutation statistics and evolved corpora stay in `fuzz/target/`; failures stay in
`fuzz/artifacts/`. CI uploads both on success or failure. `NEW`, coverage counters,
and `stat::number_of_executed_units` in each log show that native code was mutated,
rather than merely replaying fixtures. Build outputs are private to this worktree.

## Preserve a finding

Replay and minimize an artifact before changing the parser:

```sh
cargo +nightly-2026-07-20 fuzz run source fuzz/artifacts/source/crash-HASH
cargo +nightly-2026-07-20 fuzz tmin source fuzz/artifacts/source/crash-HASH -- -runs=10000 -max_total_time=60 -timeout=5 -rss_limit_mb=2048
```

Replace `source` with the owning target. Keep the minimized bytes as a normal
regression fixture in the owning crate, add a focused test that fails before the
fix, and keep the corpus seed when it adds coverage. Do not suppress a crash or
convert it into an accepted diagnostic in the harness. No crashes were known when
this harness was added; that is bounded evidence, not a proof of parser safety.

## Tool choices

[cargo-fuzz 0.13.2](https://docs.rs/crate/cargo-fuzz/0.13.2) is the released driver;
[libfuzzer-sys 0.4.13](https://docs.rs/crate/libfuzzer-sys/0.4.13) wraps LLVM's
coverage-guided mutation engine. Both versions were checked against their
published primary crate documentation. The installed `nightly-2026-07-20`
(`rustc 1.99.0-nightly`, commit `9f36de775`) builds this dependency graph with
AddressSanitizer. The [Rust Fuzz Book](https://rust-fuzz.github.io/book/cargo-fuzz/setup.html)
documents the nightly/C++ requirements and supported platforms;
[LLVM's libFuzzer reference](https://llvm.org/docs/LibFuzzer.html) defines the seed,
execution, input, timeout, and memory flags used here.
