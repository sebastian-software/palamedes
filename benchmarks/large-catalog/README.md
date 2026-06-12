# Large Catalog Benchmark Fixture

This directory contains the deterministic generator used by
`scripts/benchmark-proof.mjs` when the `--large-messages` option is set.

The fixture is generated in memory instead of checked in as a 10k or 50k PO
file. That keeps the repository small while making large-catalog runs
reproducible.

Example:

```bash
node ./scripts/benchmark-proof.mjs --warmup 1 --runs 3 --large-messages 10000
```

For a larger stress run:

```bash
node ./scripts/benchmark-proof.mjs --warmup 1 --runs 3 --large-messages 50000 --large-source-files 50
```
