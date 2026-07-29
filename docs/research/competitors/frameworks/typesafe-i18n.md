---
title: typesafe-i18n
category: frontend-framework
scope: oss-client-framework
subject: typesafe-i18n-runtime-and-generator
license: MIT
analyzed: 2026-07-26
analyzed_versions: "typesafe-i18n 5.27.1; repository state 2026-07-26"
homepage: https://github.com/codingcommons/typesafe-i18n
repository: https://github.com/codingcommons/typesafe-i18n
---

# typesafe-i18n

> Evaluation note: keep this dossier as technical reference, but do not include
> the project on active comparison pages without rechecking maintenance status.

## Technical snapshot

| Fact | Value |
| --- | --- |
| Message identity | Keys derived from the base-locale TypeScript object |
| Type model | Generated locale and translation function types |
| Runtime | Small generated formatter/runtime |
| Catalogs | TypeScript/JavaScript locale objects |
| Extraction | Declaration/generation workflow rather than source scan |
| ICU / PO | Neither is native |

The base locale defines the complete typed shape. The generator creates locale
types and formatter functions so missing keys, arguments, and formatter inputs
become TypeScript errors. Framework adapters expose the generated API through
the host's state primitives.

Its own placeholder and plural syntax favors compact generated TypeScript over
ICU interoperability. The approach is strongest when compile-time completeness
matters more than standard catalog exchange.

## What it does differently

typesafe-i18n makes the generated TypeScript type graph the product. Palamedes
keeps interoperable PO/ICU data authoritative and generates host types around
that catalog workflow.

## Sources

- https://github.com/codingcommons/typesafe-i18n — accessed 2026-07-26
- https://github.com/codingcommons/typesafe-i18n/tree/master/packages/generator — accessed 2026-07-26
- https://www.npmjs.com/package/typesafe-i18n/v/5.27.1 — accessed 2026-07-26
