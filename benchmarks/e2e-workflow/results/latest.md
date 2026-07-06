# End-to-End Extract and Catalog Update Benchmark

Generated: 2026-07-06T21:31:33.279Z
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
| Palamedes | 31.64 ms | 30.96 ms, 31.26 ms, 31.58 ms, 31.64 ms, 32.43 ms, 32.54 ms, 32.64 ms |
| Lingui | 674.05 ms | 669.80 ms, 670.57 ms, 670.89 ms, 674.05 ms, 677.15 ms, 687.44 ms, 696.00 ms |
| i18next-parser | 499.18 ms | 483.35 ms, 486.62 ms, 491.23 ms, 499.18 ms, 501.80 ms, 504.69 ms, 511.24 ms |

| Comparison | Faster | Speedup |
| --- | --- | ---: |
| Palamedes vs Lingui | Palamedes | 21.31x |
| Palamedes vs i18next-parser | Palamedes | 15.78x |

## Medium

- Corpus: 240 files, 1920 current messages, 1872 baseline messages
- Inventory mix: 144 changed, 192 new, 144 removed
- Semantic validation: 1920 active messages per locale and tool

| Tool | Median | Samples |
| --- | ---: | --- |
| Palamedes | 43.37 ms | 41.62 ms, 42.89 ms, 43.16 ms, 43.37 ms, 43.82 ms, 43.86 ms, 45.83 ms |
| Lingui | 745.33 ms | 737.34 ms, 739.18 ms, 743.75 ms, 745.33 ms, 749.24 ms, 758.24 ms, 761.59 ms |
| i18next-parser | 546.32 ms | 542.48 ms, 545.49 ms, 545.76 ms, 546.32 ms, 547.37 ms, 549.62 ms, 557.00 ms |

| Comparison | Faster | Speedup |
| --- | --- | ---: |
| Palamedes vs Lingui | Palamedes | 17.19x |
| Palamedes vs i18next-parser | Palamedes | 12.60x |

## Realistic

- Corpus: 1500 files, 6000 current messages, 5850 baseline messages
- Inventory mix: 450 changed, 600 new, 450 removed
- Semantic validation: 6000 active messages per locale and tool

| Tool | Median | Samples |
| --- | ---: | --- |
| Palamedes | 173.50 ms | 171.48 ms, 173.37 ms, 173.40 ms, 173.50 ms, 174.38 ms, 175.14 ms, 175.79 ms |
| Lingui | 2254.38 ms | 2151.10 ms, 2189.77 ms, 2212.12 ms, 2254.38 ms, 2293.86 ms, 2317.98 ms, 2364.67 ms |
| i18next-parser | 1561.82 ms | 1504.38 ms, 1508.71 ms, 1551.71 ms, 1561.82 ms, 1565.77 ms, 1589.36 ms, 1591.71 ms |

| Comparison | Faster | Speedup |
| --- | --- | ---: |
| Palamedes vs Lingui | Palamedes | 12.99x |
| Palamedes vs i18next-parser | Palamedes | 9.00x |

## Notes

- These are machine-local CLI workflow timings, not universal cross-machine claims.
- The i18next-parser corpus uses natural-language keys so semantic comparison can normalize active messages; key-based application architectures may have different catalog shapes.
- The harness reports source-message equivalence after each run instead of assuming every parser extracts the same result.
- Raw samples and Palamedes timing breakdowns are stored in the accompanying JSON output.