---
title: React Intl
category: frontend-framework
scope: oss-client-framework
subject: formatjs-react-intl-runtime-and-tooling
license: BSD-3-Clause
analyzed: 2026-07-06
analyzed_versions: "react-intl 10.1.14; @formatjs/intl 4.1.14; @formatjs/cli 1.1.18; intl-messageformat 11.2.9"
homepage: https://formatjs.github.io
repository: https://github.com/formatjs/formatjs
---

# React Intl

## Technical snapshot

| Fact             | Value                                              |
| ---------------- | -------------------------------------------------- |
| Message identity | Explicit or generated descriptor IDs               |
| Message syntax   | ICU MessageFormat                                  |
| Runtime          | React provider/components/hooks over FormatJS Intl |
| Catalogs         | Commonly JSON descriptors/compiled AST             |
| Extraction       | Babel/TypeScript transforms and FormatJS CLI       |
| Compilation      | ICU parsing and optional AST precompilation        |
| PO               | No native PO catalog workflow                      |

React Intl is the React binding over FormatJS' ECMA-402 and ICU tooling. Message
descriptors carry ID, default message, and description. Extraction collects
those descriptors, while compilation can parse messages ahead of time to avoid
shipping the parser.

Rich-text placeholders map ICU tags to React render functions. Date, number,
relative-time, list, and display-name formatting use the same provider/runtime
surface.

## What it does differently

React Intl treats explicit descriptors, ICU, and the JavaScript Intl platform
as the stable abstraction. Palamedes adds a source-string-first PO workflow,
native extraction/transform core, and broader framework adapters.

## Sources

- https://formatjs.github.io/docs/react-intl — accessed 2026-07-06
- https://formatjs.github.io/docs/getting-started/message-extraction — accessed 2026-07-06
- https://formatjs.github.io/docs/tooling/cli — accessed 2026-07-06
- https://github.com/formatjs/formatjs — accessed 2026-07-06
