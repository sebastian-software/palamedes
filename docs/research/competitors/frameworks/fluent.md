---
title: Project Fluent / fluent.js
category: frontend-framework
scope: oss-client-framework
subject: fluent-js-runtime-and-react-binding
license: Apache-2.0
analyzed: 2026-07-26
analyzed_versions: "@fluent/bundle 0.19.1; @fluent/react repository state 2026-07-26"
homepage: https://projectfluent.org
repository: https://github.com/projectfluent/fluent.js
---

# Project Fluent / fluent.js

## Technical snapshot

| Fact             | Value                                                                        |
| ---------------- | ---------------------------------------------------------------------------- |
| Message identity | Stable identifiers in FTL resources                                          |
| Message model    | Fluent syntax with attributes, terms, selectors, and asymmetric localization |
| Runtime          | `@fluent/bundle`; React binding available                                    |
| Catalog format   | Fluent Translation List (`.ftl`)                                             |
| Extraction       | No first-party source scanner in the JS runtime                              |
| ICU / PO         | Neither is the native model                                                  |

Fluent's central technical idea is asymmetric localization: a target message may
encode grammatical distinctions that are absent from the source message.
Selectors can depend on variables, platform, or locale-specific categories,
and terms allow translators to reuse language-specific concepts.

The JavaScript implementation parses FTL resources into bundles. Framework
bindings format messages and provide safe rich-text/DOM overlay behavior.
Unlike Palamedes, Fluent does not use source text as identity and does not treat
PO or ICU MessageFormat as its interchange center.

## What it does differently

Fluent gives the translator's language model more authority than an
English-shaped ICU message. That is the strongest technical challenge in this
comparison set to Palamedes' source-string-first, ICU-centered approach.

## Sources

- https://projectfluent.org/fluent/guide/ — accessed 2026-07-26
- https://github.com/projectfluent/fluent.js — accessed 2026-07-26
- https://www.npmjs.com/package/@fluent/bundle — accessed 2026-07-26
- https://www.npmjs.com/package/@fluent/react — accessed 2026-07-26
