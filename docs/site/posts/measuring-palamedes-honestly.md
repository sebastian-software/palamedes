# Measuring Palamedes Honestly

Status: draft

Benchmarks are useful when they answer a narrow question.

They get less useful when they become a slogan. "Fast" is easy to say and hard
to evaluate. Palamedes takes a smaller route: keep the benchmark fixtures and
commands in the repo, measure the operations the tool actually claims to make
better, and publish the method next to the numbers.

The current benchmark scope is deliberately limited:

- end-to-end extract/update workflow
- macro transform
- source extraction
- catalog update
- catalog artifact compile

Those are the paths where Palamedes should benefit from a native core, a single
catalog engine, and less duplicated framework-level work.

The strongest checked comparison is the end-to-end extract/update workflow:

```bash
pnpm benchmark:e2e-workflow
```

That harness compares Palamedes, Lingui, and i18next-parser on the same
generated source/catalog update workflow and writes machine-readable results
under `benchmarks/e2e-workflow/results/`.

The hot-path proof command is not hidden behind a private dashboard either:

```bash
pnpm benchmark:proof
```

For a quicker sample:

```bash
node ./scripts/benchmark-proof.mjs --warmup 1 --runs 3
```

The fixture corpus is checked in under `benchmarks/proof-fixtures`. It is not a
synthetic "one empty function" benchmark, and it is not the full example app
matrix either. It sits in the middle: enough real source shape to exercise
React macros, JSX, tagged template paths, client-oriented modules,
server-oriented modules, catalog update, and artifact compilation.

That boundary is important.

The benchmark does not claim universal speed across every application. It does
not claim that Rust makes every path faster by default. It does not treat one
local machine run as a law of nature.

It shows the current measured behavior for the operations Palamedes owns.

The repo also keeps a separate Lingui v6 harness:

```bash
pnpm benchmark:lingui-v6
```

That harness separates Babel and SWC lanes instead of turning them into one
blended number. It is a comparison tool, not a dunk. Lingui is the closest
authoring-model neighbor to Palamedes, so the comparison has to be fair to be
useful.

This is the larger product point: performance claims are easier to trust when
the method is boring and reproducible.

Palamedes can say "the native core helps" because the work is inspectable:

- [proof and benchmark methodology](../../proof-and-benchmarks.md)
- [end-to-end workflow benchmark](../../benchmark-e2e-workflow.md)
- [Lingui v6 benchmark notes](../../benchmark-lingui-v6-preview.md)
- [benchmark fixtures](../../../benchmarks/proof-fixtures/src/client-app.tsx)
- [the script that runs the proof benchmark](../../../scripts/benchmark-proof.mjs)

The best benchmark page is not the one with the biggest number. It is the one
that lets a skeptical maintainer rerun the command and understand what was
measured.

That is the bar Palamedes should keep.
