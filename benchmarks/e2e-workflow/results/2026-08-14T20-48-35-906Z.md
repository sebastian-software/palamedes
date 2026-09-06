# End-to-End Extraction Workflow Benchmark

Generated: 2026-08-14T20:48:35.906Z
Node: v24.19.0
Platform: darwin/arm64
Seed: 20260703
Warmup: 3
Runs: 7
Machine-local: yes

## Versions

- Palamedes CLI: pmds (Palamedes) v1.17.3
- Lingui CLI: 6.6.0
- React Intl extraction CLI (@formatjs/cli): 6.16.16
- fbtee CLI (@nkzw/fbtee-cli): 3.0.1 (corpus authored against fbtee 3.0.1)
- i18next-cli: 1.69.0
- General Translation CLI (gtx-cli): 2.16.4 (corpus authored against gt-react 11.1.6)

## Methodology

- Scope: scan sources, extract messages, update catalogs, and write catalog files
- Corpus: same generated logical message inventory rendered into each tool's idiomatic source shape
- Reset: catalog files and tool caches are reset to the same baseline state before every cold warmup and measured run
- Semantic check: active catalog messages are normalized after each tool run and compared with the generated current inventory
- React Intl scope: source scan, extraction, content-hash ID generation, and one aggregated extracted-message JSON write; the React Intl extraction workflow does not update locale translation catalogs, so this lane covers less work than every other lane in the table
- fbtee scope: two-command local workflow: fbtee collect scans sources and writes source_strings.json, then fbtee prepare-translations merges/updates existing en/de JSON catalogs; both Node process startups are inside the timed boundary
- General Translation scope: source scan, extraction, content-hash keying, and merge/update of existing en/de catalogs; gtx-cli generate runs fully locally, seeds new entries with the source text, and drops removed entries immediately instead of marking them obsolete
- Other tool scope: source scan, extraction, merge/update of existing en/de catalogs, and catalog writes

## Small

- Corpus: 80 files, 640 current messages, 624 baseline messages
- Inventory mix: 48 changed, 64 new, 48 removed
- Semantic validation: 640 active messages per catalog target and tool

### Cold

| Tool | Median | Samples |
| --- | ---: | --- |
| Palamedes | 11.93 ms | 10.73 ms, 11.54 ms, 11.87 ms, 11.93 ms, 12.09 ms, 12.17 ms, 12.31 ms |
| Lingui | 618.10 ms | 616.68 ms, 616.70 ms, 616.96 ms, 618.10 ms, 625.04 ms, 625.73 ms, 628.91 ms |
| React Intl | 229.11 ms | 222.15 ms, 224.09 ms, 227.90 ms, 229.11 ms, 237.99 ms, 238.97 ms, 240.41 ms |
| fbtee | 537.28 ms | 529.33 ms, 531.77 ms, 537.18 ms, 537.28 ms, 538.20 ms, 540.65 ms, 556.36 ms |
| i18next-cli | 326.62 ms | 321.85 ms, 325.21 ms, 325.49 ms, 326.62 ms, 326.99 ms, 327.54 ms, 328.98 ms |
| General Translation | 443.86 ms | 437.66 ms, 437.83 ms, 439.88 ms, 443.86 ms, 443.89 ms, 445.26 ms, 458.12 ms |

| Comparison | Faster | Speedup |
| --- | --- | ---: |
| Palamedes vs Lingui | Palamedes | 51.83x |
| Palamedes vs React Intl | Palamedes | 19.21x |
| Palamedes vs fbtee | Palamedes | 45.05x |
| Palamedes vs i18next-cli | Palamedes | 27.39x |
| Palamedes vs General Translation | Palamedes | 37.22x |

### Warm

Repeat run after touching 5 source files, with catalogs reset but tool caches kept.

This lane is **not** a like-for-like speed comparison and is deliberately excluded from the speedup table above. Palamedes reuses an extraction cache here; the other tools re-extract in full because they have no comparable local cache, so their warm and cold numbers are the same by design. Read it as a capability difference, not as a claim that the same work is done faster.

| Tool | Median | Samples |
| --- | ---: | --- |
| Palamedes | 9.09 ms | 8.74 ms, 8.80 ms, 9.05 ms, 9.09 ms, 9.10 ms, 9.11 ms, 9.34 ms |
| Lingui | 617.45 ms | 612.22 ms, 612.68 ms, 616.34 ms, 617.45 ms, 620.63 ms, 626.59 ms, 626.96 ms |
| React Intl | 222.29 ms | 219.99 ms, 220.76 ms, 222.16 ms, 222.29 ms, 222.83 ms, 222.86 ms, 226.28 ms |
| fbtee | 538.80 ms | 535.19 ms, 535.20 ms, 538.31 ms, 538.80 ms, 540.19 ms, 542.72 ms, 566.94 ms |
| i18next-cli | 322.12 ms | 319.16 ms, 321.46 ms, 321.82 ms, 322.12 ms, 322.44 ms, 322.82 ms, 324.01 ms |
| General Translation | 446.95 ms | 441.95 ms, 444.66 ms, 445.98 ms, 446.95 ms, 448.23 ms, 451.42 ms, 457.54 ms |

## Medium

- Corpus: 240 files, 1920 current messages, 1872 baseline messages
- Inventory mix: 144 changed, 192 new, 144 removed
- Semantic validation: 1920 active messages per catalog target and tool

### Cold

| Tool | Median | Samples |
| --- | ---: | --- |
| Palamedes | 21.12 ms | 17.26 ms, 19.77 ms, 20.99 ms, 21.12 ms, 21.22 ms, 21.50 ms, 21.75 ms |
| Lingui | 691.20 ms | 680.59 ms, 684.20 ms, 686.67 ms, 691.20 ms, 692.26 ms, 693.95 ms, 699.74 ms |
| React Intl | 246.85 ms | 244.15 ms, 246.15 ms, 246.44 ms, 246.85 ms, 246.89 ms, 246.94 ms, 247.49 ms |
| fbtee | 1058.43 ms | 1054.77 ms, 1057.61 ms, 1058.24 ms, 1058.43 ms, 1058.91 ms, 1061.71 ms, 1070.37 ms |
| i18next-cli | 518.95 ms | 511.84 ms, 514.43 ms, 517.36 ms, 518.95 ms, 523.54 ms, 539.47 ms, 565.90 ms |
| General Translation | 510.98 ms | 506.93 ms, 506.98 ms, 510.12 ms, 510.98 ms, 511.56 ms, 512.95 ms, 533.51 ms |

| Comparison | Faster | Speedup |
| --- | --- | ---: |
| Palamedes vs Lingui | Palamedes | 32.72x |
| Palamedes vs React Intl | Palamedes | 11.69x |
| Palamedes vs fbtee | Palamedes | 50.11x |
| Palamedes vs i18next-cli | Palamedes | 24.57x |
| Palamedes vs General Translation | Palamedes | 24.19x |

### Warm

Repeat run after touching 5 source files, with catalogs reset but tool caches kept.

This lane is **not** a like-for-like speed comparison and is deliberately excluded from the speedup table above. Palamedes reuses an extraction cache here; the other tools re-extract in full because they have no comparable local cache, so their warm and cold numbers are the same by design. Read it as a capability difference, not as a claim that the same work is done faster.

| Tool | Median | Samples |
| --- | ---: | --- |
| Palamedes | 12.87 ms | 12.69 ms, 12.70 ms, 12.76 ms, 12.87 ms, 12.90 ms, 13.49 ms, 13.50 ms |
| Lingui | 695.54 ms | 685.46 ms, 687.47 ms, 692.26 ms, 695.54 ms, 697.96 ms, 698.40 ms, 706.22 ms |
| React Intl | 244.07 ms | 242.62 ms, 243.32 ms, 243.79 ms, 244.07 ms, 244.76 ms, 245.15 ms, 248.27 ms |
| fbtee | 1063.72 ms | 1059.21 ms, 1061.18 ms, 1061.34 ms, 1063.72 ms, 1071.59 ms, 1073.35 ms, 1075.50 ms |
| i18next-cli | 518.14 ms | 510.87 ms, 517.24 ms, 517.49 ms, 518.14 ms, 518.19 ms, 518.93 ms, 526.05 ms |
| General Translation | 508.55 ms | 502.95 ms, 504.05 ms, 506.67 ms, 508.55 ms, 510.88 ms, 518.81 ms, 519.07 ms |

## Realistic

- Corpus: 1500 files, 6000 current messages, 5850 baseline messages
- Inventory mix: 450 changed, 600 new, 450 removed
- Semantic validation: 6000 active messages per catalog target and tool

### Cold

| Tool | Median | Samples |
| --- | ---: | --- |
| Palamedes | 72.55 ms | 68.75 ms, 68.82 ms, 69.76 ms, 72.55 ms, 72.90 ms, 73.84 ms, 77.65 ms |
| Lingui | 2199.62 ms | 2181.54 ms, 2195.02 ms, 2195.67 ms, 2199.62 ms, 2200.50 ms, 2200.93 ms, 2213.02 ms |
| React Intl | 424.33 ms | 422.66 ms, 422.70 ms, 423.75 ms, 424.33 ms, 425.07 ms, 426.89 ms, 428.28 ms |
| fbtee | 7262.88 ms | 7205.74 ms, 7244.47 ms, 7260.51 ms, 7262.88 ms, 7267.77 ms, 7277.53 ms, 7496.21 ms |
| i18next-cli | 5817.65 ms | 5604.73 ms, 5614.93 ms, 5689.12 ms, 5817.65 ms, 5824.37 ms, 5914.40 ms, 5927.59 ms |
| General Translation | 5107.94 ms | 4995.85 ms, 5070.69 ms, 5094.49 ms, 5107.94 ms, 5112.99 ms, 5145.49 ms, 5223.12 ms |

| Comparison | Faster | Speedup |
| --- | --- | ---: |
| Palamedes vs Lingui | Palamedes | 30.32x |
| Palamedes vs React Intl | Palamedes | 5.85x |
| Palamedes vs fbtee | Palamedes | 100.12x |
| Palamedes vs i18next-cli | Palamedes | 80.19x |
| Palamedes vs General Translation | Palamedes | 70.41x |

### Warm

Repeat run after touching 5 source files, with catalogs reset but tool caches kept.

This lane is **not** a like-for-like speed comparison and is deliberately excluded from the speedup table above. Palamedes reuses an extraction cache here; the other tools re-extract in full because they have no comparable local cache, so their warm and cold numbers are the same by design. Read it as a capability difference, not as a claim that the same work is done faster.

| Tool | Median | Samples |
| --- | ---: | --- |
| Palamedes | 46.72 ms | 42.37 ms, 45.08 ms, 45.64 ms, 46.72 ms, 48.76 ms, 49.32 ms, 49.35 ms |
| Lingui | 2221.88 ms | 2162.47 ms, 2171.67 ms, 2202.95 ms, 2221.88 ms, 2258.80 ms, 2292.91 ms, 2371.13 ms |
| React Intl | 422.57 ms | 420.60 ms, 420.91 ms, 422.50 ms, 422.57 ms, 430.79 ms, 434.07 ms, 441.81 ms |
| fbtee | 7246.06 ms | 7206.95 ms, 7231.17 ms, 7244.83 ms, 7246.06 ms, 7276.14 ms, 7292.60 ms, 7322.71 ms |
| i18next-cli | 5909.26 ms | 5812.96 ms, 5825.22 ms, 5853.52 ms, 5909.26 ms, 6015.62 ms, 6042.08 ms, 6115.17 ms |
| General Translation | 4953.04 ms | 4798.36 ms, 4862.73 ms, 4943.19 ms, 4953.04 ms, 4985.14 ms, 5013.96 ms, 5127.44 ms |

## Notes

- These are machine-local CLI workflow timings, not universal cross-machine claims.
- Cold runs clear every tool cache alongside the catalogs. The source corpus is generated once per profile and never changes, so a retained cache would be hit by every run after the first and would silently turn the cold medians into warm ones.
- The i18next-cli corpus uses natural-language keys so semantic comparison can normalize active messages; key-based application architectures may have different catalog shapes.
- **React Intl covers less work than every other lane.** `formatjs extract` writes one aggregated extracted-message JSON artifact and never reads or merges a locale catalog, so its median is not comparable to the catalog-update medians around it and must not be read as one.
- The fbtee lane times its official two-command local workflow: `fbtee collect` followed by `fbtee prepare-translations`. It updates en/de JSON catalogs like the full lanes, but pays two Node process startups and drops removed hash entries instead of retaining obsolete catalog history.
- The General Translation lane runs `gtx-cli generate`, which extracts and merges en/de catalogs entirely locally with no API key and no network access. It is GT's path for teams handling their own translations; GT's default workflow (`gtx-cli translate`) sends content to the GT API and is deliberately out of scope here.
- The harness reports source-message equivalence after each run instead of assuming every parser extracts the same result.
- Raw samples and Palamedes timing breakdowns are stored in the accompanying JSON output.