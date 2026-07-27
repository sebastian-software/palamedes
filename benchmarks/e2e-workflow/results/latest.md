# End-to-End Extraction Workflow Benchmark

Generated: 2026-07-27T14:55:31.521Z
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
- Reset: catalog files and tool caches are reset to the same baseline state before every cold warmup and measured run
- Semantic check: active catalog messages are normalized after each tool run and compared with the generated current inventory
- FormatJS scope: source scan, extraction, content-hash ID generation, and one aggregated extracted-message JSON write; FormatJS does not update locale translation catalogs
- Other tool scope: source scan, extraction, merge/update of existing en/de catalogs, and catalog writes

## Small

- Corpus: 80 files, 640 current messages, 624 baseline messages
- Inventory mix: 48 changed, 64 new, 48 removed
- Semantic validation: 640 active messages per catalog target and tool

### Cold

| Tool | Median | Samples |
| --- | ---: | --- |
| Palamedes | 32.69 ms | 30.16 ms, 31.34 ms, 32.32 ms, 32.69 ms, 34.04 ms, 34.22 ms, 34.41 ms |
| Lingui | 668.88 ms | 651.94 ms, 656.68 ms, 658.59 ms, 668.88 ms, 669.17 ms, 672.01 ms, 675.54 ms |
| FormatJS | 272.57 ms | 268.92 ms, 270.84 ms, 271.50 ms, 272.57 ms, 272.63 ms, 273.96 ms, 274.50 ms |
| i18next-parser | 516.72 ms | 511.94 ms, 513.43 ms, 516.30 ms, 516.72 ms, 524.97 ms, 528.86 ms, 531.44 ms |
| i18next-cli | 392.97 ms | 375.48 ms, 377.71 ms, 385.52 ms, 392.97 ms, 397.32 ms, 406.43 ms, 425.39 ms |

| Comparison | Faster | Speedup |
| --- | --- | ---: |
| Palamedes vs Lingui | Palamedes | 20.46x |
| Palamedes vs FormatJS | Palamedes | 8.34x |
| Palamedes vs i18next-parser | Palamedes | 15.81x |
| Palamedes vs i18next-cli | Palamedes | 12.02x |

### Warm

Repeat run after touching 5 source files, with catalogs reset but tool caches kept.

This lane is **not** a like-for-like speed comparison and is deliberately excluded from the speedup table above. Palamedes reuses an extraction cache here; the other tools re-extract in full because they have no comparable local cache, so their warm and cold numbers are the same by design. Read it as a capability difference, not as a claim that the same work is done faster.

| Tool | Median | Samples |
| --- | ---: | --- |
| Palamedes | 30.86 ms | 26.15 ms, 30.29 ms, 30.58 ms, 30.86 ms, 32.73 ms, 32.99 ms, 33.75 ms |
| Lingui | 650.31 ms | 644.88 ms, 646.20 ms, 650.05 ms, 650.31 ms, 651.07 ms, 654.38 ms, 655.01 ms |
| FormatJS | 272.51 ms | 268.86 ms, 270.63 ms, 271.40 ms, 272.51 ms, 273.68 ms, 274.73 ms, 275.61 ms |
| i18next-parser | 509.72 ms | 506.16 ms, 507.98 ms, 509.21 ms, 509.72 ms, 513.51 ms, 517.61 ms, 550.28 ms |
| i18next-cli | 388.35 ms | 383.39 ms, 383.71 ms, 387.07 ms, 388.35 ms, 389.03 ms, 391.20 ms, 398.91 ms |

## Medium

- Corpus: 240 files, 1920 current messages, 1872 baseline messages
- Inventory mix: 144 changed, 192 new, 144 removed
- Semantic validation: 1920 active messages per catalog target and tool

### Cold

| Tool | Median | Samples |
| --- | ---: | --- |
| Palamedes | 47.74 ms | 45.45 ms, 45.69 ms, 47.50 ms, 47.74 ms, 48.43 ms, 50.05 ms, 59.45 ms |
| Lingui | 736.15 ms | 722.56 ms, 727.20 ms, 730.28 ms, 736.15 ms, 739.12 ms, 741.97 ms, 758.60 ms |
| FormatJS | 298.06 ms | 296.57 ms, 296.72 ms, 297.14 ms, 298.06 ms, 299.17 ms, 299.75 ms, 300.57 ms |
| i18next-parser | 571.65 ms | 560.72 ms, 562.61 ms, 567.98 ms, 571.65 ms, 572.55 ms, 573.13 ms, 575.06 ms |
| i18next-cli | 572.93 ms | 571.53 ms, 572.06 ms, 572.09 ms, 572.93 ms, 575.89 ms, 578.91 ms, 582.93 ms |

| Comparison | Faster | Speedup |
| --- | --- | ---: |
| Palamedes vs Lingui | Palamedes | 15.42x |
| Palamedes vs FormatJS | Palamedes | 6.24x |
| Palamedes vs i18next-parser | Palamedes | 11.97x |
| Palamedes vs i18next-cli | Palamedes | 12.00x |

### Warm

Repeat run after touching 5 source files, with catalogs reset but tool caches kept.

This lane is **not** a like-for-like speed comparison and is deliberately excluded from the speedup table above. Palamedes reuses an extraction cache here; the other tools re-extract in full because they have no comparable local cache, so their warm and cold numbers are the same by design. Read it as a capability difference, not as a claim that the same work is done faster.

| Tool | Median | Samples |
| --- | ---: | --- |
| Palamedes | 39.87 ms | 36.91 ms, 38.72 ms, 39.69 ms, 39.87 ms, 40.21 ms, 41.02 ms, 41.15 ms |
| Lingui | 734.95 ms | 731.73 ms, 732.34 ms, 734.19 ms, 734.95 ms, 736.51 ms, 740.37 ms, 749.86 ms |
| FormatJS | 296.64 ms | 293.11 ms, 294.27 ms, 294.54 ms, 296.64 ms, 297.76 ms, 299.95 ms, 302.21 ms |
| i18next-parser | 565.38 ms | 559.55 ms, 560.62 ms, 563.58 ms, 565.38 ms, 568.83 ms, 572.58 ms, 574.12 ms |
| i18next-cli | 574.30 ms | 571.83 ms, 572.25 ms, 573.12 ms, 574.30 ms, 576.47 ms, 577.06 ms, 579.04 ms |

## Realistic

- Corpus: 1500 files, 6000 current messages, 5850 baseline messages
- Inventory mix: 450 changed, 600 new, 450 removed
- Semantic validation: 6000 active messages per catalog target and tool

### Cold

| Tool | Median | Samples |
| --- | ---: | --- |
| Palamedes | 125.88 ms | 121.44 ms, 123.60 ms, 123.98 ms, 125.88 ms, 126.09 ms, 127.35 ms, 137.22 ms |
| Lingui | 2279.13 ms | 2203.25 ms, 2205.46 ms, 2216.86 ms, 2279.13 ms, 2283.82 ms, 2284.80 ms, 2413.79 ms |
| FormatJS | 464.63 ms | 455.93 ms, 461.22 ms, 463.70 ms, 464.63 ms, 465.87 ms, 466.22 ms, 468.35 ms |
| i18next-parser | 1578.61 ms | 1567.01 ms, 1569.44 ms, 1573.75 ms, 1578.61 ms, 1588.05 ms, 1625.89 ms, 1683.12 ms |
| i18next-cli | 5668.44 ms | 5623.07 ms, 5644.78 ms, 5658.25 ms, 5668.44 ms, 5671.64 ms, 5773.21 ms, 5820.89 ms |

| Comparison | Faster | Speedup |
| --- | --- | ---: |
| Palamedes vs Lingui | Palamedes | 18.11x |
| Palamedes vs FormatJS | Palamedes | 3.69x |
| Palamedes vs i18next-parser | Palamedes | 12.54x |
| Palamedes vs i18next-cli | Palamedes | 45.03x |

### Warm

Repeat run after touching 5 source files, with catalogs reset but tool caches kept.

This lane is **not** a like-for-like speed comparison and is deliberately excluded from the speedup table above. Palamedes reuses an extraction cache here; the other tools re-extract in full because they have no comparable local cache, so their warm and cold numbers are the same by design. Read it as a capability difference, not as a claim that the same work is done faster.

| Tool | Median | Samples |
| --- | ---: | --- |
| Palamedes | 70.08 ms | 67.78 ms, 68.26 ms, 68.63 ms, 70.08 ms, 71.57 ms, 72.00 ms, 72.53 ms |
| Lingui | 2211.67 ms | 2195.89 ms, 2198.18 ms, 2208.38 ms, 2211.67 ms, 2255.73 ms, 2259.66 ms, 2283.43 ms |
| FormatJS | 468.96 ms | 464.05 ms, 464.85 ms, 466.47 ms, 468.96 ms, 472.53 ms, 475.09 ms, 475.11 ms |
| i18next-parser | 1551.61 ms | 1522.12 ms, 1525.54 ms, 1536.32 ms, 1551.61 ms, 1557.04 ms, 1558.82 ms, 1566.88 ms |
| i18next-cli | 6048.73 ms | 5584.67 ms, 5594.72 ms, 5649.78 ms, 6048.73 ms, 6068.20 ms, 6448.04 ms, 6599.99 ms |

## Notes

- These are machine-local CLI workflow timings, not universal cross-machine claims.
- Cold runs clear every tool cache alongside the catalogs. The source corpus is generated once per profile and never changes, so a retained cache would be hit by every run after the first and would silently turn the cold medians into warm ones.
- The i18next-parser and i18next-cli corpora use natural-language keys so semantic comparison can normalize active messages; key-based application architectures may have different catalog shapes.
- FormatJS writes one extracted-message JSON artifact and does not update locale translation catalogs; its result is reported with that narrower scope instead of being presented as a catalog-merge equivalent.
- The harness reports source-message equivalence after each run instead of assuming every parser extracts the same result.
- Raw samples and Palamedes timing breakdowns are stored in the accompanying JSON output.