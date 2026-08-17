---
title: fbtee
category: frontend-framework
scope: oss-client-framework
subject: fbtee-runtime-compiler-and-cli
license: MIT
analyzed: 2026-08-14
analyzed_versions: "fbtee 3.0.1; @nkzw/fbtee-cli 3.0.1; @nkzw/babel-preset-fbtee 3.0.1; @nkzw/swc-plugin-fbtee 3.0.1"
homepage: https://fbtee.dev
repository: https://github.com/nkzw-tech/fbtee
---

# fbtee

## Technical snapshot

| Fact              | Value                                                               |
| ----------------- | ------------------------------------------------------------------- |
| Authoring model   | Inline `<fbt>` JSX plus `fbt()` and plain-string `fbs()` calls      |
| Message identity  | Source text plus required description, represented by hashed keys   |
| Message model     | FBT IR/tables with params, plurals, pronouns, enums, lists, and JSX |
| Catalogs          | Hash-keyed source and per-locale JSON; generated runtime JSON       |
| Toolchain         | Babel preset or Rust/Wasm SWC transform; JavaScript extraction CLI  |
| Framework support | JavaScript and React, with documented Vite, Next.js, and Expo paths |
| ICU / PO          | Neither is the native model                                         |

fbtee is a modern, independently maintained continuation of Facebook's FBT
programming model. Developers keep source copy and mandatory translator
descriptions at the callsite. The compiler lowers JSX or function calls into
FBT tables, the CLI extracts source phrases, editable locale JSON records hold
translations and grammatical variations, and a second compile step emits
locale payloads for the runtime.

The identity model is source-derived, but the stored identity is not
source-readable. Translation entries use an MD5 hash of text plus description,
while compiled callsites use a Jenkins hash of the FBT table. That makes fbtee
much closer to Palamedes than a hand-authored-key library at the component
boundary,
but unlike Palamedes it does not keep source-string PO entries as the durable
catalog interface.

## Maturity and adoption

The underlying FBT model is not new: the predecessor was developed and used at
Facebook before its public release, and fbtee also cites production use in
Athena Crisis. The independent `fbtee` npm package is newer: it was first
published in December 2024, reached 1.0 in July 2025, and reached 3.0 in July 2026.

At the analysis date, the repository had 315 GitHub stars and 15 forks. The
runtime package recorded 4,108 npm downloads for the last complete week from
2026-08-03 through 2026-08-09. This is an active but still relatively small
independent ecosystem attached to a much older production lineage.

## Technical comparison with Palamedes

| Area               | fbtee                                     | Palamedes                                       |
| ------------------ | ----------------------------------------- | ----------------------------------------------- |
| Source authoring   | Inline copy plus required description     | Inline copy plus optional context               |
| Grammar model      | FBT-specific JSX/function primitives      | ICU MessageFormat                               |
| Durable catalog    | Hash-keyed locale JSON                    | Source-readable PO or FCL                       |
| Transform          | Babel or Rust/Wasm SWC                    | Native Palamedes transform                      |
| Catalog operations | JavaScript CLI                            | Shared Rust core for extraction through compile |
| React rich text    | Nested JSX becomes implicit parameters    | Macro/ICU component interpolation               |
| React Native       | Documented Expo path                      | Not supported                                   |
| Server integration | Runtime setup plus React server export    | Request-local runtime plus first-party adapters |
| Agent translation  | Documented status-based JSON editing flow | Repo-owned catalogs and agent-oriented surface  |

fbtee's strongest technical challenge to Palamedes is grammatical authoring.
Plurals, gendered pronouns, enums, lists, and nested React elements are explicit
parts of the FBT model rather than conventions layered on a basic lookup API.
Its current Babel, SWC, Next.js, and Expo paths also make the old model feel
current rather than archival.

Palamedes' clearest separation is below the callsite. PO/ICU interoperability,
one catalog engine for extraction, merging, audits, diagnostics, and
compilation, and first-party host adapters are architectural differences rather
than alternate spellings of the same API. fbtee's Rust component is the SWC
transform; its extraction and translation preparation remain in the
JavaScript/Babel toolchain.

The checked end-to-end workflow benchmark now includes fbtee's official local
two-command path: `fbtee collect` followed by `fbtee prepare-translations`.
Both Node process startups are timed. On the realistic profile (1,500 files,
about 400,000 lines, and 6,000 current messages), the seven-run cold median was
7,262.88 ms for fbtee and 72.55 ms for Palamedes, a 100.12x result on the test
machine.

That number is a scoped workflow comparison, not a universal implementation or
bundle-size claim. Both lanes scan the same logical inventory and update
existing `en` and `de` catalogs, and the harness verifies both the active
message set and preserved German translations. The internals remain different:
fbtee pays for two processes and an intermediate source-string artifact, uses
hash-keyed JSON, and drops removed entries rather than retaining obsolete PO
history. The exact samples, versions, and caveats are in the
[checked benchmark report](../../../../benchmarks/e2e-workflow/results/latest.md).

## Competitive assessment

**Assessment (inference):** fbtee belongs in the active comparison set. It is
not as close to Palamedes' complete PO/ICU workflow as Lingui, but it overlaps
more directly than most key-first libraries on inline source authoring,
compile-time extraction, grammatical correctness, React integration, and a
repository-local translation workflow.

The most important messaging consequence is that inline source copy and coding
agent translation are not unique differentiators. Palamedes should keep its
argument centered on the coherent native workflow, standard catalogs, ICU
semantics, request-local runtime model, and verified host coverage. fbtee should
be preferred when React Native support or FBT's dedicated gender/pronoun model
matters more than PO/ICU interoperability.

## What it does differently

fbtee modernizes Facebook's grammar-first FBT model around React and hashed JSON
artifacts. Palamedes uses a source-string-first PO/ICU model and makes one native
catalog engine, rather than the React grammar DSL, the center of the product.

## Sources

- [Checked end-to-end workflow benchmark](../../../../benchmarks/e2e-workflow/results/latest.md) — generated 2026-08-14
- https://fbtee.dev — accessed 2026-08-14
- https://github.com/nkzw-tech/fbtee — accessed 2026-08-14
- https://github.com/nkzw-tech/fbtee/blob/main/README.md — accessed 2026-08-14
- https://github.com/nkzw-tech/fbtee/blob/main/packages/babel-plugin-fbtee/src/bin/md5.tsx — accessed 2026-08-14
- https://github.com/nkzw-tech/fbtee/blob/main/packages/babel-plugin-fbtee/src/bin/collect.tsx — accessed 2026-08-14
- https://github.com/nkzw-tech/fbtee/blob/main/packages/babel-plugin-fbtee/src/bin/translate.tsx — accessed 2026-08-14
- https://github.com/nkzw-tech/fbtee/tree/main/packages/swc-plugin-fbtee — accessed 2026-08-14
- https://www.npmjs.com/package/fbtee/v/3.0.1 — accessed 2026-08-14
- https://www.npmjs.com/package/@nkzw/fbtee-cli/v/3.0.1 — accessed 2026-08-14
- https://www.npmjs.com/package/@nkzw/babel-preset-fbtee/v/3.0.1 — accessed 2026-08-14
- https://www.npmjs.com/package/@nkzw/swc-plugin-fbtee/v/3.0.1 — accessed 2026-08-14
- https://api.npmjs.org/downloads/point/2026-08-03:2026-08-09/fbtee — accessed 2026-08-14
- https://facebook.github.io/fbt/docs/collection — accessed 2026-08-14
