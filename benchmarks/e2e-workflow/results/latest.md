# End-to-End Extract and Catalog Update Benchmark

Generated: 2026-07-03T19:16:02.889Z
Node: v24.18.0
Platform: darwin/arm64
Seed: 20260703
Warmup: 3
Runs: 7
Machine-local: yes

## Versions

- Palamedes CLI: pmds (Palamedes) v0.11.4
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
| Palamedes | 33.53 ms | 31.73 ms, 32.16 ms, 33.29 ms, 33.53 ms, 33.63 ms, 33.80 ms, 36.13 ms |
| Lingui | 657.00 ms | 653.43 ms, 653.97 ms, 654.48 ms, 657.00 ms, 666.81 ms, 668.27 ms, 685.57 ms |
| i18next-parser | 477.58 ms | 475.86 ms, 476.87 ms, 477.53 ms, 477.58 ms, 477.62 ms, 479.44 ms, 485.48 ms |

| Comparison | Faster | Speedup |
| --- | --- | ---: |
| Palamedes vs Lingui | Palamedes | 19.59x |
| Palamedes vs i18next-parser | Palamedes | 14.24x |

## Medium

- Corpus: 240 files, 1920 current messages, 1872 baseline messages
- Inventory mix: 144 changed, 192 new, 144 removed
- Semantic validation: 1920 active messages per locale and tool

| Tool | Median | Samples |
| --- | ---: | --- |
| Palamedes | 42.92 ms | 41.57 ms, 41.82 ms, 42.16 ms, 42.92 ms, 42.95 ms, 43.76 ms, 45.75 ms |
| Lingui | 728.56 ms | 721.12 ms, 721.13 ms, 722.16 ms, 728.56 ms, 729.43 ms, 732.14 ms, 740.81 ms |
| i18next-parser | 534.15 ms | 529.64 ms, 530.55 ms, 531.62 ms, 534.15 ms, 535.21 ms, 538.12 ms, 542.66 ms |

| Comparison | Faster | Speedup |
| --- | --- | ---: |
| Palamedes vs Lingui | Palamedes | 16.98x |
| Palamedes vs i18next-parser | Palamedes | 12.45x |

## Notes

- These are machine-local CLI workflow timings, not universal cross-machine claims.
- The i18next-parser corpus uses natural-language keys so semantic comparison can normalize active messages; key-based application architectures may have different catalog shapes.
- The harness reports source-message equivalence after each run instead of assuming every parser extracts the same result.
- Raw samples and Palamedes timing breakdowns are stored in the accompanying JSON output.