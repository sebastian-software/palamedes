---
title: Lingui
category: frontend-framework
scope: oss-client-framework
subject: lingui-runtime-macros-and-tooling
license: MIT
analyzed: 2026-07-06
analyzed_versions: "@lingui/core 6.5.0; @lingui/cli 6.5.0; @lingui/react 6.5.0"
homepage: https://lingui.dev
repository: https://github.com/lingui/js-lingui
---

# Lingui

## Technical snapshot

| Fact             | Value                                          |
| ---------------- | ---------------------------------------------- |
| Message identity | Source text or explicit IDs                    |
| Syntax           | ICU MessageFormat through macros/descriptors   |
| Catalogs         | PO is first-class; JSON formats also available |
| Extraction       | Babel/SWC macros and CLI extraction            |
| Compilation      | Catalogs compile to compact JavaScript data    |
| Frameworks       | React, React Native, Vue, Solid, vanilla JS    |

Lingui's macros preserve natural source authoring while extracting descriptors
at build time. The CLI merges extracted messages into catalogs, and compilation
produces runtime-ready data. React APIs include components and hooks; framework-
agnostic core APIs handle activation and formatting.

Lingui is the closest technical predecessor in this comparison set to
Palamedes. The key distinction is implementation and architecture: Palamedes
puts the shared semantics and transforms in a Rust-first core and exposes thin
host adapters.

## What it does differently

Lingui centers a JavaScript macro/compiler ecosystem and supports several
catalog formats. Palamedes narrows the maintained semantics around its native
core, PO workflow, and compiled artifact boundary.

## Sources

- https://lingui.dev/introduction — accessed 2026-07-06
- https://lingui.dev/ref/macro — accessed 2026-07-06
- https://lingui.dev/ref/cli — accessed 2026-07-06
- https://lingui.dev/ref/catalog-formats — accessed 2026-07-06
- https://github.com/lingui/js-lingui — accessed 2026-07-06
