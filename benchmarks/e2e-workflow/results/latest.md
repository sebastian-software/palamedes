# End-to-End Extraction Workflow Benchmark

Generated: 2026-07-28T07:33:39.942Z
Node: v24.18.0
Platform: darwin/arm64
Seed: 20260703
Warmup: 3
Runs: 7
Machine-local: yes

## Versions

- Palamedes CLI: pmds (Palamedes) v1.8.0
- Lingui CLI: 6.5.0
- FormatJS CLI: 6.16.14
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
| Palamedes | 33.99 ms | 33.13 ms, 33.52 ms, 33.71 ms, 33.99 ms, 34.51 ms, 35.80 ms, 37.77 ms |
| Lingui | 631.05 ms | 623.29 ms, 627.90 ms, 631.04 ms, 631.05 ms, 632.40 ms, 646.87 ms, 653.65 ms |
| FormatJS | 273.88 ms | 270.53 ms, 270.53 ms, 271.25 ms, 273.88 ms, 274.81 ms, 275.32 ms, 276.63 ms |
| i18next-cli | 441.45 ms | 425.74 ms, 427.64 ms, 432.07 ms, 441.45 ms, 445.06 ms, 450.73 ms, 464.85 ms |

| Comparison | Faster | Speedup |
| --- | --- | ---: |
| Palamedes vs Lingui | Palamedes | 18.57x |
| Palamedes vs FormatJS | Palamedes | 8.06x |
| Palamedes vs i18next-cli | Palamedes | 12.99x |

### Warm

Repeat run after touching 5 source files, with catalogs reset but tool caches kept.

This lane is **not** a like-for-like speed comparison and is deliberately excluded from the speedup table above. Palamedes reuses an extraction cache here; the other tools re-extract in full because they have no comparable local cache, so their warm and cold numbers are the same by design. Read it as a capability difference, not as a claim that the same work is done faster.

| Tool | Median | Samples |
| --- | ---: | --- |
| Palamedes | 31.29 ms | 28.97 ms, 30.37 ms, 30.38 ms, 31.29 ms, 31.55 ms, 32.50 ms, 32.92 ms |
| Lingui | 633.03 ms | 627.58 ms, 630.83 ms, 632.95 ms, 633.03 ms, 638.75 ms, 641.36 ms, 641.38 ms |
| FormatJS | 276.92 ms | 273.89 ms, 275.02 ms, 275.04 ms, 276.92 ms, 277.03 ms, 278.38 ms, 279.55 ms |
| i18next-cli | 368.76 ms | 363.46 ms, 366.81 ms, 368.49 ms, 368.76 ms, 369.14 ms, 372.14 ms, 373.10 ms |

## Medium

- Corpus: 240 files, 1920 current messages, 1872 baseline messages
- Inventory mix: 144 changed, 192 new, 144 removed
- Semantic validation: 1920 active messages per catalog target and tool

### Cold

| Tool | Median | Samples |
| --- | ---: | --- |
| Palamedes | 47.54 ms | 44.13 ms, 44.66 ms, 45.62 ms, 47.54 ms, 47.64 ms, 47.94 ms, 48.04 ms |
| Lingui | 708.78 ms | 701.68 ms, 706.94 ms, 707.13 ms, 708.78 ms, 710.86 ms, 714.28 ms, 725.42 ms |
| FormatJS | 291.40 ms | 290.68 ms, 291.08 ms, 291.34 ms, 291.40 ms, 291.60 ms, 292.27 ms, 294.48 ms |
| i18next-cli | 555.34 ms | 553.90 ms, 554.38 ms, 555.08 ms, 555.34 ms, 562.89 ms, 575.00 ms, 752.74 ms |

| Comparison | Faster | Speedup |
| --- | --- | ---: |
| Palamedes vs Lingui | Palamedes | 14.91x |
| Palamedes vs FormatJS | Palamedes | 6.13x |
| Palamedes vs i18next-cli | Palamedes | 11.68x |

### Warm

Repeat run after touching 5 source files, with catalogs reset but tool caches kept.

This lane is **not** a like-for-like speed comparison and is deliberately excluded from the speedup table above. Palamedes reuses an extraction cache here; the other tools re-extract in full because they have no comparable local cache, so their warm and cold numbers are the same by design. Read it as a capability difference, not as a claim that the same work is done faster.

| Tool | Median | Samples |
| --- | ---: | --- |
| Palamedes | 39.99 ms | 37.47 ms, 38.87 ms, 39.85 ms, 39.99 ms, 40.01 ms, 40.43 ms, 41.99 ms |
| Lingui | 724.70 ms | 718.78 ms, 722.01 ms, 722.56 ms, 724.70 ms, 729.44 ms, 739.43 ms, 742.07 ms |
| FormatJS | 291.41 ms | 288.73 ms, 289.26 ms, 290.25 ms, 291.41 ms, 293.72 ms, 297.42 ms, 298.69 ms |
| i18next-cli | 661.51 ms | 654.04 ms, 658.61 ms, 659.63 ms, 661.51 ms, 670.12 ms, 671.09 ms, 683.48 ms |

## Realistic

- Corpus: 1500 files, 6000 current messages, 5850 baseline messages
- Inventory mix: 450 changed, 600 new, 450 removed
- Semantic validation: 6000 active messages per catalog target and tool

### Cold

| Tool | Median | Samples |
| --- | ---: | --- |
| Palamedes | 122.33 ms | 116.28 ms, 118.47 ms, 120.99 ms, 122.33 ms, 126.37 ms, 127.84 ms, 144.52 ms |
| Lingui | 2280.56 ms | 2159.91 ms, 2254.86 ms, 2258.18 ms, 2280.56 ms, 2287.20 ms, 2341.46 ms, 2345.18 ms |
| FormatJS | 463.65 ms | 458.18 ms, 462.40 ms, 463.02 ms, 463.65 ms, 463.86 ms, 465.70 ms, 467.59 ms |
| i18next-cli | 5815.11 ms | 5764.27 ms, 5787.08 ms, 5809.80 ms, 5815.11 ms, 5825.85 ms, 5839.87 ms, 7943.46 ms |

| Comparison | Faster | Speedup |
| --- | --- | ---: |
| Palamedes vs Lingui | Palamedes | 18.64x |
| Palamedes vs FormatJS | Palamedes | 3.79x |
| Palamedes vs i18next-cli | Palamedes | 47.54x |

### Warm

Repeat run after touching 5 source files, with catalogs reset but tool caches kept.

This lane is **not** a like-for-like speed comparison and is deliberately excluded from the speedup table above. Palamedes reuses an extraction cache here; the other tools re-extract in full because they have no comparable local cache, so their warm and cold numbers are the same by design. Read it as a capability difference, not as a claim that the same work is done faster.

| Tool | Median | Samples |
| --- | ---: | --- |
| Palamedes | 68.92 ms | 67.96 ms, 68.16 ms, 68.43 ms, 68.92 ms, 69.66 ms, 70.40 ms, 72.29 ms |
| Lingui | 2197.84 ms | 2137.12 ms, 2182.77 ms, 2195.68 ms, 2197.84 ms, 2229.47 ms, 2245.15 ms, 2277.38 ms |
| FormatJS | 462.46 ms | 459.00 ms, 459.24 ms, 460.69 ms, 462.46 ms, 462.98 ms, 466.96 ms, 470.69 ms |
| i18next-cli | 6104.09 ms | 5854.81 ms, 5874.48 ms, 5889.68 ms, 6104.09 ms, 6512.22 ms, 6897.23 ms, 7175.89 ms |

## Notes

- These are machine-local CLI workflow timings, not universal cross-machine claims.
- Cold runs clear every tool cache alongside the catalogs. The source corpus is generated once per profile and never changes, so a retained cache would be hit by every run after the first and would silently turn the cold medians into warm ones.
- The i18next-cli corpus uses natural-language keys so semantic comparison can normalize active messages; key-based application architectures may have different catalog shapes.
- FormatJS writes one extracted-message JSON artifact and does not update locale translation catalogs; its result is reported with that narrower scope instead of being presented as a catalog-merge equivalent.
- The harness reports source-message equivalence after each run instead of assuming every parser extracts the same result.
- Raw samples and Palamedes timing breakdowns are stored in the accompanying JSON output.