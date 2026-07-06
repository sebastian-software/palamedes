# End-to-End Extract and Catalog Update Benchmark

Generated: 2026-07-06T18:05:29.525Z
Node: v24.18.0
Platform: darwin/arm64
Seed: 20260703
Warmup: 3
Runs: 7
Machine-local: yes

## Versions

- Palamedes CLI: pmds (Palamedes) v1.3.0
- Lingui CLI: 6.4.0
- i18next-parser CLI: 9.4.0

## Methodology

- Scope: scan sources, extract messages, update catalogs, and write catalog files
- Corpus: same generated logical message inventory rendered into each tool's idiomatic source shape
- Reset: catalog files are reset to the same baseline state before every warmup and measured run
- Semantic check: active catalog messages are normalized after each tool run and compared with the generated current inventory

## Small

- Corpus: 80 files, 640 current messages, 624 baseline messages
- Inventory mix: 48 changed, 64 new, 48 removed
- Semantic validation: 640 active messages per locale and tool

| Tool | Median | Samples |
| --- | ---: | --- |
| Palamedes | 33.41 ms | 32.61 ms, 32.99 ms, 33.39 ms, 33.41 ms, 34.69 ms, 34.81 ms, 39.01 ms |
| Lingui | 738.18 ms | 725.37 ms, 727.51 ms, 734.01 ms, 738.18 ms, 743.53 ms, 748.11 ms, 774.96 ms |
| i18next-parser | 531.39 ms | 509.65 ms, 512.65 ms, 524.16 ms, 531.39 ms, 533.00 ms, 533.17 ms, 534.88 ms |

| Comparison | Faster | Speedup |
| --- | --- | ---: |
| Palamedes vs Lingui | Palamedes | 22.10x |
| Palamedes vs i18next-parser | Palamedes | 15.91x |

## Medium

- Corpus: 240 files, 1920 current messages, 1872 baseline messages
- Inventory mix: 144 changed, 192 new, 144 removed
- Semantic validation: 1920 active messages per locale and tool

| Tool | Median | Samples |
| --- | ---: | --- |
| Palamedes | 46.27 ms | 42.96 ms, 45.01 ms, 45.77 ms, 46.27 ms, 46.46 ms, 46.75 ms, 48.28 ms |
| Lingui | 800.75 ms | 786.81 ms, 791.56 ms, 793.40 ms, 800.75 ms, 804.89 ms, 814.36 ms, 847.85 ms |
| i18next-parser | 583.00 ms | 567.70 ms, 568.53 ms, 576.00 ms, 583.00 ms, 583.25 ms, 585.27 ms, 617.98 ms |

| Comparison | Faster | Speedup |
| --- | --- | ---: |
| Palamedes vs Lingui | Palamedes | 17.31x |
| Palamedes vs i18next-parser | Palamedes | 12.60x |

## Realistic

- Corpus: 400 files, 10000 current messages, 9750 baseline messages
- Inventory mix: 750 changed, 1000 new, 750 removed
- Semantic validation: 10000 active messages per locale and tool

| Tool | Median | Samples |
| --- | ---: | --- |
| Palamedes | 83.75 ms | 80.42 ms, 82.79 ms, 83.69 ms, 83.75 ms, 84.20 ms, 84.99 ms, 90.31 ms |
| Lingui | 1060.24 ms | 1040.99 ms, 1051.32 ms, 1058.28 ms, 1060.24 ms, 1071.15 ms, 1096.20 ms, 1109.83 ms |
| i18next-parser | 787.15 ms | 779.01 ms, 783.77 ms, 786.50 ms, 787.15 ms, 792.85 ms, 801.31 ms, 812.54 ms |

| Comparison | Faster | Speedup |
| --- | --- | ---: |
| Palamedes vs Lingui | Palamedes | 12.66x |
| Palamedes vs i18next-parser | Palamedes | 9.40x |

## Notes

- These are machine-local CLI workflow timings, not universal cross-machine claims.
- The i18next-parser corpus uses natural-language keys so semantic comparison can normalize active messages; key-based application architectures may have different catalog shapes.
- The harness reports source-message equivalence after each run instead of assuming every parser extracts the same result.
- Raw samples and Palamedes timing breakdowns are stored in the accompanying JSON output.