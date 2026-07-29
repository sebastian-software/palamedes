---
title: Paraglide JS
category: frontend-framework
scope: oss-client-framework
subject: paraglide-js-compiler-and-runtime
license: MIT
analyzed: 2026-07-06
analyzed_versions: "@inlang/paraglide-js 2.20.2; inlang project format state 2026-07-06"
homepage: https://inlang.com/m/gerre34r/library-inlang-paraglideJs
repository: https://github.com/opral/paraglide-js
---

# Paraglide JS

## Technical snapshot

| Fact                   | Value                                                |
| ---------------------- | ---------------------------------------------------- |
| Message identity       | Explicit keys in an inlang project                   |
| Build model            | Generates one tree-shakable function per message     |
| Runtime                | Generated modules; no central formatter runtime      |
| Catalog/project format | inlang project settings plus message resources       |
| Framework support      | Framework-agnostic output with adapters/integrations |
| ICU / PO               | ICU through plugins; no native PO workflow found     |

Paraglide compiles translation resources into ESM functions. Applications
import or call generated message functions, allowing bundlers to tree-shake
unused messages and locales. Locale strategies and resource plugins are
configured through the inlang project model.

The generated-code boundary gives editors and build tools a structured project
to modify while keeping the production runtime minimal. Locale changes can
require a reload depending on the generated strategy.

## What it does differently

Paraglide makes per-message generated functions the public API. Palamedes
generates compiled catalog artifacts consumed through stable runtime APIs and
retains PO as its human/tool interchange format.

## Sources

- https://inlang.com/m/gerre34r/library-inlang-paraglideJs — accessed 2026-07-06
- https://inlang.com/documentation/concept/message — accessed 2026-07-06
- https://github.com/opral/paraglide-js — accessed 2026-07-06
- https://www.npmjs.com/package/@inlang/paraglide-js/v/2.20.2 — accessed 2026-07-06
