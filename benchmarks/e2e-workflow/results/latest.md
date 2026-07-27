# End-to-End Extraction Workflow Benchmark

Generated: 2026-07-27T09:48:40.633Z
Node: v24.18.0
Platform: darwin/arm64
Seed: 20260703
Warmup: 3
Runs: 7
Machine-local: yes

## Versions

- Palamedes CLI: pmds (Palamedes) v1.7.0
- Lingui CLI: 6.5.0
- FormatJS CLI: 6.16.14
- i18next-parser CLI: 9.4.0
- i18next-cli: 1.66.2

## Methodology

- Scope: scan sources, extract messages, update catalogs, and write catalog files
- Corpus: same generated logical message inventory rendered into each tool's idiomatic source shape
- Reset: catalog files are reset to the same baseline state before every warmup and measured run
- Semantic check: active catalog messages are normalized after each tool run and compared with the generated current inventory
- FormatJS scope: source scan, extraction, content-hash ID generation, and one aggregated extracted-message JSON write; FormatJS does not update locale translation catalogs
- Other tool scope: source scan, extraction, merge/update of existing en/de catalogs, and catalog writes

## Small

- Corpus: 80 files, 640 current messages, 624 baseline messages
- Inventory mix: 48 changed, 64 new, 48 removed
- Semantic validation: 640 active messages per catalog target and tool

| Tool | Median | Samples |
| --- | ---: | --- |
| Palamedes | 35.98 ms | 34.60 ms, 34.79 ms, 35.73 ms, 35.98 ms, 36.45 ms, 37.33 ms, 37.96 ms |
| Lingui | 658.17 ms | 646.76 ms, 648.99 ms, 652.84 ms, 658.17 ms, 660.73 ms, 671.60 ms, 682.76 ms |
| FormatJS | 275.79 ms | 264.56 ms, 267.45 ms, 273.65 ms, 275.79 ms, 278.56 ms, 299.34 ms, 324.20 ms |
| i18next-parser | 506.04 ms | 495.94 ms, 501.15 ms, 504.33 ms, 506.04 ms, 506.60 ms, 511.36 ms, 522.90 ms |
| i18next-cli | 382.87 ms | 376.08 ms, 380.10 ms, 380.57 ms, 382.87 ms, 388.44 ms, 390.98 ms, 391.44 ms |

| Comparison | Faster | Speedup |
| --- | --- | ---: |
| Palamedes vs Lingui | Palamedes | 18.29x |
| Palamedes vs FormatJS | Palamedes | 7.66x |
| Palamedes vs i18next-parser | Palamedes | 14.06x |
| Palamedes vs i18next-cli | Palamedes | 10.64x |

## Medium

- Corpus: 240 files, 1920 current messages, 1872 baseline messages
- Inventory mix: 144 changed, 192 new, 144 removed
- Semantic validation: 1920 active messages per catalog target and tool

| Tool | Median | Samples |
| --- | ---: | --- |
| Palamedes | 47.68 ms | 46.96 ms, 47.00 ms, 47.61 ms, 47.68 ms, 48.01 ms, 48.02 ms, 48.86 ms |
| Lingui | 732.81 ms | 726.86 ms, 727.18 ms, 727.72 ms, 732.81 ms, 738.14 ms, 741.18 ms, 750.68 ms |
| FormatJS | 293.86 ms | 290.91 ms, 291.85 ms, 293.18 ms, 293.86 ms, 294.13 ms, 296.86 ms, 303.92 ms |
| i18next-parser | 565.67 ms | 554.56 ms, 558.14 ms, 560.73 ms, 565.67 ms, 568.95 ms, 568.98 ms, 581.87 ms |
| i18next-cli | 568.56 ms | 561.39 ms, 562.11 ms, 563.43 ms, 568.56 ms, 581.75 ms, 593.30 ms, 654.56 ms |

| Comparison | Faster | Speedup |
| --- | --- | ---: |
| Palamedes vs Lingui | Palamedes | 15.37x |
| Palamedes vs FormatJS | Palamedes | 6.16x |
| Palamedes vs i18next-parser | Palamedes | 11.86x |
| Palamedes vs i18next-cli | Palamedes | 11.93x |

## Realistic

- Corpus: 1500 files, 6000 current messages, 5850 baseline messages
- Inventory mix: 450 changed, 600 new, 450 removed
- Semantic validation: 6000 active messages per catalog target and tool

| Tool | Median | Samples |
| --- | ---: | --- |
| Palamedes | 192.94 ms | 188.89 ms, 188.97 ms, 191.08 ms, 192.94 ms, 193.07 ms, 194.87 ms, 208.09 ms |
| Lingui | 2342.49 ms | 2263.75 ms, 2272.46 ms, 2279.21 ms, 2342.49 ms, 2359.24 ms, 2512.46 ms, 2522.21 ms |
| FormatJS | 472.18 ms | 466.56 ms, 470.61 ms, 472.06 ms, 472.18 ms, 474.37 ms, 477.28 ms, 484.39 ms |
| i18next-parser | 1540.72 ms | 1515.38 ms, 1531.99 ms, 1535.44 ms, 1540.72 ms, 1544.97 ms, 1569.04 ms, 1582.41 ms |
| i18next-cli | 5804.35 ms | 5775.11 ms, 5782.31 ms, 5800.13 ms, 5804.35 ms, 5892.86 ms, 6127.09 ms, 6212.82 ms |

| Comparison | Faster | Speedup |
| --- | --- | ---: |
| Palamedes vs Lingui | Palamedes | 12.14x |
| Palamedes vs FormatJS | Palamedes | 2.45x |
| Palamedes vs i18next-parser | Palamedes | 7.99x |
| Palamedes vs i18next-cli | Palamedes | 30.08x |

## Notes

- These are machine-local CLI workflow timings, not universal cross-machine claims.
- The i18next-parser and i18next-cli corpora use natural-language keys so semantic comparison can normalize active messages; key-based application architectures may have different catalog shapes.
- FormatJS writes one extracted-message JSON artifact and does not update locale translation catalogs; its result is reported with that narrower scope instead of being presented as a catalog-merge equivalent.
- The harness reports source-message equivalence after each run instead of assuming every parser extracts the same result.
- Raw samples and Palamedes timing breakdowns are stored in the accompanying JSON output.