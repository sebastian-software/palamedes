---
title: Paraglide JS
category: frontend-framework
scope: oss-client-framework
subject: paraglide-js-compiler-and-runtime
license: MIT
analyzed: 2026-08-16
analyzed_versions: "@inlang/paraglide-js 2.23.2; inlang project format state 2026-08-16"
homepage: https://paraglidejs.com
repository: https://github.com/opral/paraglide-js
ecosystem_repository: https://github.com/opral/inlang
---

# Paraglide JS

## Scope boundary

This dossier and the public comparison page cover the Paraglide compiler and
runtime because that is the surface directly comparable to the open-source
Palamedes core. They do not treat the entire inlang repository as one i18n
library. Inlang describes that broader project as an open-format TMS spanning
the canonical project format, SDK, plugins, editor and CI integrations, and
Lix-backed workflows. Those TMS and platform concerns are outside the public
[OSS client/framework boundary](../README.md#boundary).

## Technical snapshot

| Fact                   | Value                                                 |
| ---------------------- | ----------------------------------------------------- |
| Message identity       | Explicit keys in an inlang project                    |
| Build model            | Generates one tree-shakable function per message      |
| Runtime                | Generated modules; no central formatter runtime       |
| Catalog/project format | inlang project; external resource files via plugins   |
| Framework support      | Framework-agnostic output with adapters/integrations  |
| ICU / PO               | ICU through a plugin; no first-party PO plugin listed |

Paraglide compiles translation resources into ESM functions. Applications
import or call generated message functions, allowing bundlers to tree-shake
unused messages and locales. Locale strategies and resource plugins are
configured through the inlang project model. Plugins can import and export
external translation files such as JSON, YAML, or i18next resources.

The generated-code boundary gives editors and build tools a structured project
to modify while keeping the production runtime minimal. Locale changes can
require a reload depending on the generated strategy.

## What it does differently

Paraglide makes per-message generated functions the public API. Palamedes
generates compiled catalog artifacts consumed through stable runtime APIs and
retains PO as its human/tool interchange format.

## Sources

- https://paraglidejs.com — accessed 2026-08-16
- https://paraglidejs.com/file-formats — accessed 2026-08-16
- https://github.com/opral/paraglide-js — accessed 2026-08-16
- https://github.com/opral/paraglide-js/blob/main/package.json — accessed 2026-08-16
- https://github.com/opral/inlang — accessed 2026-08-16
- https://inlang.com/docs/introduction — accessed 2026-08-16
- https://inlang.com/c/plugins — accessed 2026-08-16
