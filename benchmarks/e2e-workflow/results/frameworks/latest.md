# Framework Extraction and Catalog Update Workflows

Generated: 2026-10-23T10:31:32.634Z
Revision: a061f66e7f4030d22962166d926f331ee57412c4
Working tree dirty: false
Node: v24.22.0
Platform: darwin/arm64
CPU: Apple M1 Ultra
Warmup: 3
Samples: 7

These are machine-local cold CLI workflow measurements. Every sample resets existing catalogs and local tool state. Fixture generation, baseline extraction, correctness checks, and report writing are outside the timer. Source discovery, process startup, parsing, catalog merge and writes are inside. Every measured result passes catalog and translation-preservation checks.

Wuchale additionally transforms components in memory and compiles catalogs. Intlayer additionally generates/builds dictionaries and prepares its project artifacts. Their timings cover more work than extract/update-only lanes. No speedup ratios are generated across these different scopes. Application bundling and runtime rendering are not measured. The corpus contains plain strings and one-variable interpolation, without plurals, rich text or context disambiguation.

The Intlayer candidate uses multilingual .content.json dictionaries. Its failed conformance receipt is specific to that configuration. The separate untimed `diagnose:intlayer` command compares .content.json and .content.ts roundtrips; TypeScript preserves the unchanged translations in the pinned smoke fixture, while both formats retain removed entries.

Solid sources target the Solid 1.9 versions supported by these comparator adapters. This is an extraction workload, not evidence of Solid 2 or application/SSR compatibility.

## Versions

- @lingui/cli: 6.6.0
- @lingui/core: 6.6.0
- @lingui/extractor-vue: 6.6.0
- @lingui/solid: 6.6.0
- lingui-for-svelte: 0.7.1
- i18next-cli: 1.72.1
- i18next-cli-vue: 1.0.4
- i18next-cli-plugin-svelte: 2.4.1
- wuchale: 0.26.7
- @wuchale/jsx: 0.13.0
- @wuchale/svelte: 0.21.4
- vue3-gettext: 4.0.1
- intlayer-cli: 9.7.0
- @intlayer/babel: 9.7.0
- @intlayer/vue-compiler: 9.7.0
- @intlayer/svelte-compiler: 9.7.0
- vue: 3.5.44
- svelte: 5.57.2
- solid-js: 1.9.17
- palamedes: pmds (Palamedes) v1.25.1
Fast i18n tooling for modern apps
- gettext: msgmerge (GNU gettext-tools) 1.0

## small

Inventory: 640 current, 624 baseline; 48 changed, 64 new, 48 removed.

### vue

| Tool | Scope | Files | Source bytes | Median | Min–max | Preserved translations |
| --- | --- | ---: | ---: | ---: | --- | ---: |
| Palamedes | extract-update | 80 | 71430 | 11.94 ms | 11.18–12.54 ms | 528 |
| Lingui | extract-update | 80 | 100780 | 767.06 ms | 761.32–774.50 ms | 528 |
| i18next-cli | extract-update | 80 | 67480 | 418.77 ms | 408.02–421.16 ms | 528 |
| vue3-gettext | extract-update | 80 | 63295 | 154.45 ms | 152.28–159.83 ms | 528 |
| Intlayer | catalog validation failed | — | — | excluded | — | 450/528 |

Intlayer is excluded from timings: vue-intlayer: en: 688 messages, expected 640; 0 missing, 48 unexpected, 0 duplicates; de: 688 messages, expected 640; 0 missing, 48 unexpected, 0 duplicates; 78 existing translations lost, including "Archive billing overview for {name} 00112-now".

### svelte

| Tool | Scope | Files | Source bytes | Median | Min–max | Preserved translations |
| --- | --- | ---: | ---: | ---: | --- | ---: |
| Palamedes | extract-update | 80 | 65990 | 11.79 ms | 10.75–12.30 ms | 528 |
| Lingui | extract-update | 80 | 49670 | 946.09 ms | 926.89–979.43 ms | 528 |
| i18next-cli | extract-update | 80 | 54840 | 552.34 ms | 547.07–567.08 ms | 528 |
| Wuchale | extract-update-compile | 80 | 36150 | 304.88 ms | 302.68–313.42 ms | 528 |
| Intlayer | catalog validation failed | — | — | excluded | — | 450/528 |

Intlayer is excluded from timings: svelte-intlayer: en: 688 messages, expected 640; 0 missing, 48 unexpected, 0 duplicates; de: 688 messages, expected 640; 0 missing, 48 unexpected, 0 duplicates; 78 existing translations lost, including "Archive billing overview for {name} 00112-now".

### solid

| Tool | Scope | Files | Source bytes | Median | Min–max | Preserved translations |
| --- | --- | ---: | ---: | ---: | --- | ---: |
| Palamedes | extract-update | 80 | 60060 | 12.70 ms | 11.99–13.03 ms | 528 |
| Lingui | extract-update | 80 | 50620 | 556.87 ms | 548.64–567.50 ms | 528 |
| i18next-cli | extract-update | 80 | 56110 | 357.63 ms | 349.97–368.93 ms | 528 |
| Wuchale | extract-update-compile | 80 | 37420 | 187.00 ms | 184.75–200.31 ms | 528 |
| Intlayer | catalog validation failed | — | — | excluded | — | 450/528 |

Intlayer is excluded from timings: solid-intlayer: en: 688 messages, expected 640; 0 missing, 48 unexpected, 0 duplicates; de: 688 messages, expected 640; 0 missing, 48 unexpected, 0 duplicates; 78 existing translations lost, including "Archive billing overview for {name} 00112-now".


## medium

Inventory: 1920 current, 1872 baseline; 144 changed, 192 new, 144 removed.

### vue

| Tool | Scope | Files | Source bytes | Median | Min–max | Preserved translations |
| --- | --- | ---: | ---: | ---: | --- | ---: |
| Palamedes | extract-update | 240 | 214201 | 18.62 ms | 16.83–20.87 ms | 1584 |
| Lingui | extract-update | 240 | 302162 | 906.15 ms | 893.85–929.89 ms | 1584 |
| i18next-cli | extract-update | 240 | 202321 | 623.29 ms | 612.22–637.02 ms | 1584 |
| vue3-gettext | extract-update | 240 | 189781 | 261.90 ms | 260.34–267.86 ms | 1584 |
| Intlayer | catalog validation failed | — | — | excluded | — | 1344/1584 |

Intlayer is excluded from timings: vue-intlayer: en: 2064 messages, expected 1920; 0 missing, 144 unexpected, 0 duplicates; de: 2064 messages, expected 1920; 0 missing, 144 unexpected, 0 duplicates; 240 existing translations lost, including "Approve billing overview for {name} 00400-now".

### svelte

| Tool | Scope | Files | Source bytes | Median | Min–max | Preserved translations |
| --- | --- | ---: | ---: | ---: | --- | ---: |
| Palamedes | extract-update | 240 | 197881 | 18.08 ms | 16.59–19.95 ms | 1584 |
| Lingui | extract-update | 240 | 148921 | 1096.04 ms | 1083.62–1102.70 ms | 1584 |
| i18next-cli | extract-update | 240 | 164401 | 811.00 ms | 794.06–834.01 ms | 1584 |
| Wuchale | extract-update-compile | 240 | 108361 | 407.11 ms | 398.00–418.57 ms | 1584 |
| Intlayer | catalog validation failed | — | — | excluded | — | 1344/1584 |

Intlayer is excluded from timings: svelte-intlayer: en: 2064 messages, expected 1920; 0 missing, 144 unexpected, 0 duplicates; de: 2064 messages, expected 1920; 0 missing, 144 unexpected, 0 duplicates; 240 existing translations lost, including "Approve billing overview for {name} 00400-now".

### solid

| Tool | Scope | Files | Source bytes | Median | Min–max | Preserved translations |
| --- | --- | ---: | ---: | ---: | --- | ---: |
| Palamedes | extract-update | 240 | 180251 | 20.50 ms | 19.39–22.65 ms | 1584 |
| Lingui | extract-update | 240 | 151931 | 643.02 ms | 636.55–652.43 ms | 1584 |
| i18next-cli | extract-update | 240 | 168371 | 566.96 ms | 561.62–584.18 ms | 1584 |
| Wuchale | extract-update-compile | 240 | 112331 | 267.93 ms | 263.96–286.05 ms | 1584 |
| Intlayer | catalog validation failed | — | — | excluded | — | 1344/1584 |

Intlayer is excluded from timings: solid-intlayer: en: 2064 messages, expected 1920; 0 missing, 144 unexpected, 0 duplicates; de: 2064 messages, expected 1920; 0 missing, 144 unexpected, 0 duplicates; 240 existing translations lost, including "Approve billing overview for {name} 00400-now".


## realistic

Inventory: 6000 current, 5850 baseline; 450 changed, 600 new, 450 removed.

### vue

| Tool | Scope | Files | Source bytes | Median | Min–max | Preserved translations |
| --- | --- | ---: | ---: | ---: | --- | ---: |
| Palamedes | extract-update | 1500 | 11280763 | 103.36 ms | 78.98–110.50 ms | 4950 |
| Lingui | extract-update | 1500 | 11787696 | 2798.30 ms | 2750.35–2986.75 ms | 4950 |
| i18next-cli | extract-update | 1500 | 11234563 | 4340.66 ms | 4232.14–4535.95 ms | 4950 |
| vue3-gettext | extract-update | 1500 | 11422443 | 1492.36 ms | 1439.23–1513.49 ms | 4950 |
| Intlayer | catalog validation failed | — | — | excluded | — | 4215/4950 |

Intlayer is excluded from timings: vue-intlayer: en: 6450 messages, expected 6000; 0 missing, 450 unexpected, 0 duplicates; de: 6450 messages, expected 6000; 0 missing, 450 unexpected, 0 duplicates; 735 existing translations lost, including "Publish portal toolbar for {name} 01100-now".

### svelte

| Tool | Scope | Files | Source bytes | Median | Min–max | Preserved translations |
| --- | --- | ---: | ---: | ---: | --- | ---: |
| Palamedes | extract-update | 1500 | 11282903 | 106.90 ms | 74.56–120.64 ms | 4950 |
| Lingui | extract-update | 1500 | 11371793 | 2253.19 ms | 2185.58–2332.52 ms | 4950 |
| i18next-cli | extract-update | 1500 | 11406593 | 11884.86 ms | 11453.70–12149.65 ms | 4950 |
| Wuchale | extract-update-compile | 1500 | 11253293 | 5597.34 ms | 5469.03–5921.34 ms | 4950 |
| Intlayer | catalog validation failed | — | — | excluded | — | 4215/4950 |

Intlayer is excluded from timings: svelte-intlayer: en: 6450 messages, expected 6000; 0 missing, 450 unexpected, 0 duplicates; de: 6450 messages, expected 6000; 0 missing, 450 unexpected, 0 duplicates; 735 existing translations lost, including "Publish portal toolbar for {name} 01100-now".

### solid

| Tool | Scope | Files | Source bytes | Median | Min–max | Preserved translations |
| --- | --- | ---: | ---: | ---: | --- | ---: |
| Palamedes | extract-update | 1500 | 11478683 | 109.07 ms | 83.81–132.79 ms | 4950 |
| Lingui | extract-update | 1500 | 11391683 | 2614.73 ms | 2551.62–2671.44 ms | 4950 |
| i18next-cli | extract-update | 1500 | 11432483 | 6777.63 ms | 6599.46–7074.02 ms | 4950 |
| Wuchale | extract-update-compile | 1500 | 11279183 | 4173.70 ms | 4078.99–4316.44 ms | 4950 |
| Intlayer | catalog validation failed | — | — | excluded | — | 4215/4950 |

Intlayer is excluded from timings: solid-intlayer: en: 6450 messages, expected 6000; 0 missing, 450 unexpected, 0 duplicates; de: 6450 messages, expected 6000; 0 missing, 450 unexpected, 0 duplicates; 735 existing translations lost, including "Publish portal toolbar for {name} 01100-now".

## Reproduction

```sh
pnpm --dir benchmarks/e2e-workflow/frameworks benchmark
```

The companion JSON retains every sample, dispersion, source hashes, adapter versions and semantic receipts. Run on an otherwise idle machine; laptop power/thermal state and background activity are not controlled. A small or smoke profile does not establish large-project performance.
