---
title: Intlayer
category: frontend-framework
scope: oss-client-framework
subject: intlayer-framework-and-client-tooling
license: Apache-2.0
analyzed: 2026-07-26
analyzed_versions: "intlayer 9.0.1; repository state 2026-07-26"
homepage: https://intlayer.org
repository: https://github.com/aymericzip/intlayer
---

# Intlayer

## Technical snapshot

| Fact              | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| Authoring model   | Co-located typed content declarations                           |
| Message identity  | Declaration keys and generated content accessors                |
| Build model       | Declaration discovery plus generated dictionaries/types         |
| Framework support | React, Next.js, Vue, Nuxt, Svelte, Angular, and others          |
| Formats           | Native declarations plus configurable ICU/i18next/Vue/PO inputs |
| Extraction        | Declaration-based; no source-string scan required               |

Intlayer co-locates content declarations with components rather than discovering
messages from UI code. A build step finds declarations, validates them, and
generates the runtime/type surfaces used by framework adapters.

Declarations can be local and statically bundled. Remote and hybrid dictionary
locations exist but are outside this client-only comparison.

## What it does differently

Intlayer replaces extraction with explicit, typed, component-local content
declarations. Palamedes keeps UI authoring close to normal source text and
extracts that text into repo-owned PO catalogs.

## Sources

- https://intlayer.org/doc/concept/content — accessed 2026-07-26
- https://intlayer.org/doc/concept/how-works-intlayer — accessed 2026-07-26
- https://github.com/aymericzip/intlayer — accessed 2026-07-26
- https://www.npmjs.com/package/intlayer/v/9.0.1 — accessed 2026-07-26
