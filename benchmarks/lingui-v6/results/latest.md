# Palamedes vs. Lingui v6 Benchmark

Generated: 2026-07-27T09:45:09.215Z
Node: v24.18.0
Platform: darwin/arm64
Seed: 20260318
Warmup: 5
Runs: 15
Machine-local: yes

## Versions

- Palamedes core: 1.7.0
- Ferrocat: 2.2.0
- Babel core: 8.0.1
- SWC core: 1.15.46
- Lingui CLI: 6.5.0
- Lingui Babel macro plugin: 6.5.0
- Lingui SWC plugin: 6.5.1
- Lingui format-po: 6.5.0

## Track Definitions

- Macro Transform (Babel): Palamedes single native macro transform path; comparator Lingui Babel macro plugin
  Note: Palamedes has a single native macro transform path, so the same measured baseline is intentionally reported against both Lingui transform lanes.
- Macro Transform (SWC): Palamedes single native macro transform path; comparator Lingui SWC plugin
  Note: Palamedes has a single native macro transform path, so the same measured baseline is intentionally reported against both Lingui transform lanes.
- Extract: Palamedes native source extraction; comparator Lingui Babel extractor
- Compile from Catalog: Palamedes catalog artifact assembly; comparator PO parse plus compiled catalog payload

## Smoke Checks

- Example files checked: 5
- Example transform parity: palamedes=5, lingui-babel=5, lingui-swc=5
- Example extract parity: 7 messages

- Example compile nextjs-cookie: palamedes=28 messages, lingui=28 messages

## Small

- Corpus: 100 files, 1000 messages, 136466 source bytes
- Validation: transform palamedes=100, lingui-babel=100, lingui-swc=100; extract=1000; compile=1000

| Track | Palamedes median | Lingui median | Faster | Speedup |
| --- | ---: | ---: | --- | ---: |
| Macro Transform (Babel) | 42.07 ms | 83.62 ms | palamedes | 1.99x |
| Macro Transform (SWC) | 42.07 ms | 40.29 ms | lingui | 1.04x |
| Extract | 22.51 ms | 106.63 ms | palamedes | 4.74x |
| Compile from Catalog | 36.53 ms | 5.36 ms | lingui | 6.81x |

## Medium

- Corpus: 400 files, 4000 messages, 546349 source bytes
- Validation: transform palamedes=400, lingui-babel=400, lingui-swc=400; extract=4000; compile=4000

| Track | Palamedes median | Lingui median | Faster | Speedup |
| --- | ---: | ---: | --- | ---: |
| Macro Transform (Babel) | 176.01 ms | 325.95 ms | palamedes | 1.85x |
| Macro Transform (SWC) | 176.01 ms | 161.83 ms | lingui | 1.09x |
| Extract | 90.19 ms | 410.20 ms | palamedes | 4.55x |
| Compile from Catalog | 133.09 ms | 21.25 ms | lingui | 6.26x |

## Large

- Corpus: 1200 files, 12000 messages, 1638622 source bytes
- Validation: transform palamedes=1200, lingui-babel=1200, lingui-swc=1200; extract=12000; compile=12000

| Track | Palamedes median | Lingui median | Faster | Speedup |
| --- | ---: | ---: | --- | ---: |
| Macro Transform (Babel) | 531.81 ms | 937.56 ms | palamedes | 1.76x |
| Macro Transform (SWC) | 531.81 ms | 504.64 ms | lingui | 1.05x |
| Extract | 271.20 ms | 1271.12 ms | palamedes | 4.69x |
| Compile from Catalog | 404.35 ms | 68.66 ms | lingui | 5.89x |

## Notes

- Palamedes has a single native macro transform path, so the same measured baseline is intentionally reported against both Lingui transform lanes.
- Results are machine-local and should not be treated as universal cross-machine claims.
- Build-system integration, watch mode, and catalog update are intentionally excluded from this head-to-head comparison.
- Raw samples are stored in the accompanying JSON output.