# Palamedes vs. Lingui v6 Benchmark

Generated: 2026-07-05T20:27:53.982Z
Node: v24.18.0
Platform: darwin/arm64
Seed: 20260318
Warmup: 1
Runs: 3
Machine-local: yes

## Versions

- Palamedes core: 1.1.2
- Ferrocat: 2.1.1
- Babel core: 8.0.1
- SWC core: 1.15.43
- Lingui CLI: 6.4.0
- Lingui Babel macro plugin: 6.4.0
- Lingui SWC plugin: 6.4.0
- Lingui format-po: 6.4.0

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

- Corpus: 100 files, 1000 messages, 140216 source bytes
- Validation: transform palamedes=100, lingui-babel=100, lingui-swc=100; extract=1000; compile=1000

| Track | Palamedes median | Lingui median | Faster | Speedup |
| --- | ---: | ---: | --- | ---: |
| Macro Transform (Babel) | 36.65 ms | 103.72 ms | palamedes | 2.83x |
| Macro Transform (SWC) | 36.65 ms | 50.90 ms | palamedes | 1.39x |
| Extract | 22.85 ms | 113.14 ms | palamedes | 4.95x |
| Compile from Catalog | 36.19 ms | 5.84 ms | lingui | 6.19x |

## Notes

- Palamedes has a single native macro transform path, so the same measured baseline is intentionally reported against both Lingui transform lanes.
- Results are machine-local and should not be treated as universal cross-machine claims.
- Build-system integration, watch mode, and catalog update are intentionally excluded from this head-to-head comparison.
- Raw samples are stored in the accompanying JSON output.