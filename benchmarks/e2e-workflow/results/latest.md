# End-to-End Extraction Workflow Benchmark

Generated: 2026-08-05T09:07:39.077Z
Node: v24.18.0
Platform: darwin/arm64
Seed: 20260703
Warmup: 3
Runs: 7
Machine-local: yes

## Versions

- Palamedes CLI: pmds (Palamedes) v1.12.0
- Lingui CLI: 6.6.0
- React Intl extraction CLI (@formatjs/cli): 6.16.16
- i18next-cli: 1.67.3
- General Translation CLI (gtx-cli): 2.16.0 (corpus authored against gt-react 11.1.4)

## Methodology

- Scope: scan sources, extract messages, update catalogs, and write catalog files
- Corpus: same generated logical message inventory rendered into each tool's idiomatic source shape
- Reset: catalog files and tool caches are reset to the same baseline state before every cold warmup and measured run
- Semantic check: active catalog messages are normalized after each tool run and compared with the generated current inventory
- React Intl scope: source scan, extraction, content-hash ID generation, and one aggregated extracted-message JSON write; the React Intl extraction workflow does not update locale translation catalogs, so this lane covers less work than every other lane in the table
- General Translation scope: source scan, extraction, content-hash keying, and merge/update of existing en/de catalogs; gtx-cli generate runs fully locally, seeds new entries with the source text, and drops removed entries immediately instead of marking them obsolete
- Other tool scope: source scan, extraction, merge/update of existing en/de catalogs, and catalog writes

## Small

- Corpus: 80 files, 640 current messages, 624 baseline messages
- Inventory mix: 48 changed, 64 new, 48 removed
- Semantic validation: 640 active messages per catalog target and tool

### Cold

| Tool | Median | Samples |
| --- | ---: | --- |
| Palamedes | 14.11 ms | 13.61 ms, 13.89 ms, 13.97 ms, 14.11 ms, 14.24 ms, 14.33 ms, 14.85 ms |
| Lingui | 747.18 ms | 732.13 ms, 734.16 ms, 742.39 ms, 747.18 ms, 759.62 ms, 793.19 ms, 795.97 ms |
| React Intl | 288.59 ms | 280.05 ms, 282.14 ms, 286.90 ms, 288.59 ms, 291.94 ms, 294.56 ms, 304.48 ms |
| i18next-cli | 625.87 ms | 454.76 ms, 483.26 ms, 594.90 ms, 625.87 ms, 980.50 ms, 980.89 ms, 1032.25 ms |
| General Translation | 577.89 ms | 554.21 ms, 564.58 ms, 571.48 ms, 577.89 ms, 630.93 ms, 652.02 ms, 813.98 ms |

| Comparison | Faster | Speedup |
| --- | --- | ---: |
| Palamedes vs Lingui | Palamedes | 52.94x |
| Palamedes vs React Intl | Palamedes | 20.45x |
| Palamedes vs i18next-cli | Palamedes | 44.35x |
| Palamedes vs General Translation | Palamedes | 40.95x |

### Warm

Repeat run after touching 5 source files, with catalogs reset but tool caches kept.

This lane is **not** a like-for-like speed comparison and is deliberately excluded from the speedup table above. Palamedes reuses an extraction cache here; the other tools re-extract in full because they have no comparable local cache, so their warm and cold numbers are the same by design. Read it as a capability difference, not as a claim that the same work is done faster.

| Tool | Median | Samples |
| --- | ---: | --- |
| Palamedes | 10.76 ms | 10.12 ms, 10.21 ms, 10.58 ms, 10.76 ms, 10.97 ms, 10.98 ms, 11.47 ms |
| Lingui | 944.16 ms | 689.07 ms, 716.49 ms, 937.28 ms, 944.16 ms, 1027.13 ms, 1173.49 ms, 1383.13 ms |
| React Intl | 290.94 ms | 282.95 ms, 284.66 ms, 287.56 ms, 290.94 ms, 292.84 ms, 294.13 ms, 296.33 ms |
| i18next-cli | 436.59 ms | 430.96 ms, 434.61 ms, 435.70 ms, 436.59 ms, 439.63 ms, 446.25 ms, 452.35 ms |
| General Translation | 593.57 ms | 569.96 ms, 591.97 ms, 593.22 ms, 593.57 ms, 605.73 ms, 607.05 ms, 623.82 ms |

## Medium

- Corpus: 240 files, 1920 current messages, 1872 baseline messages
- Inventory mix: 144 changed, 192 new, 144 removed
- Semantic validation: 1920 active messages per catalog target and tool

### Cold

| Tool | Median | Samples |
| --- | ---: | --- |
| Palamedes | 23.80 ms | 22.10 ms, 22.54 ms, 23.66 ms, 23.80 ms, 24.25 ms, 24.63 ms, 25.56 ms |
| Lingui | 836.69 ms | 780.12 ms, 780.14 ms, 794.75 ms, 836.69 ms, 906.33 ms, 962.97 ms, 1360.12 ms |
| React Intl | 344.09 ms | 312.58 ms, 316.73 ms, 318.45 ms, 344.09 ms, 366.44 ms, 387.45 ms, 406.69 ms |
| i18next-cli | 658.40 ms | 644.07 ms, 653.17 ms, 657.99 ms, 658.40 ms, 659.38 ms, 668.03 ms, 671.15 ms |
| General Translation | 669.27 ms | 649.28 ms, 655.84 ms, 667.24 ms, 669.27 ms, 670.92 ms, 727.25 ms, 732.79 ms |

| Comparison | Faster | Speedup |
| --- | --- | ---: |
| Palamedes vs Lingui | Palamedes | 35.15x |
| Palamedes vs React Intl | Palamedes | 14.46x |
| Palamedes vs i18next-cli | Palamedes | 27.66x |
| Palamedes vs General Translation | Palamedes | 28.12x |

### Warm

Repeat run after touching 5 source files, with catalogs reset but tool caches kept.

This lane is **not** a like-for-like speed comparison and is deliberately excluded from the speedup table above. Palamedes reuses an extraction cache here; the other tools re-extract in full because they have no comparable local cache, so their warm and cold numbers are the same by design. Read it as a capability difference, not as a claim that the same work is done faster.

| Tool | Median | Samples |
| --- | ---: | --- |
| Palamedes | 15.16 ms | 14.62 ms, 14.69 ms, 14.87 ms, 15.16 ms, 15.32 ms, 15.60 ms, 15.87 ms |
| Lingui | 791.67 ms | 783.12 ms, 788.94 ms, 790.53 ms, 791.67 ms, 810.85 ms, 817.33 ms, 828.66 ms |
| React Intl | 318.12 ms | 310.95 ms, 312.10 ms, 315.64 ms, 318.12 ms, 319.38 ms, 319.51 ms, 326.24 ms |
| i18next-cli | 663.52 ms | 647.23 ms, 648.37 ms, 653.62 ms, 663.52 ms, 683.44 ms, 684.36 ms, 687.23 ms |
| General Translation | 654.03 ms | 636.80 ms, 638.08 ms, 645.57 ms, 654.03 ms, 655.65 ms, 656.18 ms, 682.19 ms |

## Realistic

- Corpus: 1500 files, 6000 current messages, 5850 baseline messages
- Inventory mix: 450 changed, 600 new, 450 removed
- Semantic validation: 6000 active messages per catalog target and tool

### Cold

| Tool | Median | Samples |
| --- | ---: | --- |
| Palamedes | 83.89 ms | 79.00 ms, 80.99 ms, 81.17 ms, 83.89 ms, 84.54 ms, 90.73 ms, 93.56 ms |
| Lingui | 2480.24 ms | 2368.23 ms, 2398.63 ms, 2446.92 ms, 2480.24 ms, 2484.40 ms, 2513.98 ms, 2676.59 ms |
| React Intl | 475.85 ms | 470.60 ms, 474.34 ms, 474.89 ms, 475.85 ms, 478.50 ms, 479.73 ms, 485.53 ms |
| i18next-cli | 6644.63 ms | 6533.40 ms, 6550.07 ms, 6567.71 ms, 6644.63 ms, 6650.12 ms, 6653.46 ms, 6665.60 ms |
| General Translation | 6116.43 ms | 5837.31 ms, 5947.81 ms, 6069.10 ms, 6116.43 ms, 6182.59 ms, 6403.36 ms, 6897.72 ms |

| Comparison | Faster | Speedup |
| --- | --- | ---: |
| Palamedes vs Lingui | Palamedes | 29.57x |
| Palamedes vs React Intl | Palamedes | 5.67x |
| Palamedes vs i18next-cli | Palamedes | 79.21x |
| Palamedes vs General Translation | Palamedes | 72.91x |

### Warm

Repeat run after touching 5 source files, with catalogs reset but tool caches kept.

This lane is **not** a like-for-like speed comparison and is deliberately excluded from the speedup table above. Palamedes reuses an extraction cache here; the other tools re-extract in full because they have no comparable local cache, so their warm and cold numbers are the same by design. Read it as a capability difference, not as a claim that the same work is done faster.

| Tool | Median | Samples |
| --- | ---: | --- |
| Palamedes | 33.08 ms | 32.16 ms, 32.22 ms, 33.04 ms, 33.08 ms, 33.34 ms, 33.54 ms, 34.10 ms |
| Lingui | 2459.89 ms | 2374.14 ms, 2390.50 ms, 2430.44 ms, 2459.89 ms, 2474.55 ms, 2509.84 ms, 2527.67 ms |
| React Intl | 481.17 ms | 473.74 ms, 476.06 ms, 479.11 ms, 481.17 ms, 484.29 ms, 486.01 ms, 486.35 ms |
| i18next-cli | 6708.17 ms | 6583.16 ms, 6615.68 ms, 6632.90 ms, 6708.17 ms, 6709.30 ms, 6854.99 ms, 7118.94 ms |
| General Translation | 5877.81 ms | 5692.91 ms, 5749.60 ms, 5844.95 ms, 5877.81 ms, 5969.79 ms, 6100.26 ms, 7004.54 ms |

## Notes

- These are machine-local CLI workflow timings, not universal cross-machine claims.
- Cold runs clear every tool cache alongside the catalogs. The source corpus is generated once per profile and never changes, so a retained cache would be hit by every run after the first and would silently turn the cold medians into warm ones.
- The i18next-cli corpus uses natural-language keys so semantic comparison can normalize active messages; key-based application architectures may have different catalog shapes.
- **React Intl covers less work than every other lane.** `formatjs extract` writes one aggregated extracted-message JSON artifact and never reads or merges a locale catalog, so its median is not comparable to the catalog-update medians around it and must not be read as one.
- The General Translation lane runs `gtx-cli generate`, which extracts and merges en/de catalogs entirely locally with no API key and no network access. It is GT's path for teams handling their own translations; GT's default workflow (`gtx-cli translate`) sends content to the GT API and is deliberately out of scope here.
- The harness reports source-message equivalence after each run instead of assuming every parser extracts the same result.
- Raw samples and Palamedes timing breakdowns are stored in the accompanying JSON output.