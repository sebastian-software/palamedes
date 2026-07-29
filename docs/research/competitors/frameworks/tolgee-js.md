---
title: Tolgee JS SDK
category: frontend-framework
scope: oss-client-framework
subject: tolgee-js-client-runtime-and-framework-bindings
license: MIT
analyzed: 2026-07-06
analyzed_versions: "@tolgee/core 7.1.1; @tolgee/react 7.1.1"
homepage: https://docs.tolgee.io/js-sdk
repository: https://github.com/tolgee/tolgee-js
---

# Tolgee JS SDK

This dossier covers only the MIT-licensed JavaScript client SDK. The associated
hosted/self-hosted platform, company, pricing, AI service, and enterprise
features are commercial research and deliberately excluded.

## Fact sheet

| Fact | Value |
| --- | --- |
| License | MIT |
| Packages | Framework-agnostic core plus React, Vue, Angular, and Svelte bindings |
| Message identity | Explicit string keys |
| Message syntax | ICU MessageFormat |
| Catalog delivery | Static data or a configured remote backend |
| Extraction | Separate CLI/tooling rather than source-string macro extraction |
| Distinctive client behavior | Dev-time in-context editing hooks |

## Client architecture

- `@tolgee/core` owns the framework-independent runtime and plugin surface.
- Framework packages wrap the core with framework-specific providers, hooks,
  and rendering helpers.
- The SDK uses explicit keys and ICU messages rather than Palamedes'
  source-string-first PO model.
- Runtime configuration controls available languages, fallback behavior,
  static translation data, and optional backend plugins.
- In-context editing is implemented in the client surface, but saving edits and
  related platform workflows require a configured service. This dossier does
  not evaluate that service.

## Technical comparison with Palamedes

| Area | Tolgee JS SDK | Palamedes |
| --- | --- | --- |
| Primary identity | Explicit key | Source string or explicit descriptor |
| Runtime format | ICU-oriented JSON/data | Compiled catalogs backed by PO workflows |
| Framework model | Core plus first-party framework wrappers | Host-neutral core plus framework adapters |
| Translation source | Static data or backend plugin | Repo-owned catalogs |
| In-context client UI | First-party dev tooling | Not an OSS runtime goal |

## Strengths

- A shared framework-independent core keeps behavior aligned across bindings.
- Native ICU handling supports plural and select messages.
- Framework bindings expose idiomatic APIs instead of requiring a generic
  runtime wrapper everywhere.
- Static translation data provides a usable client path without requiring this
  research to treat the commercial platform as part of the SDK.

## Limitations for a Palamedes comparison

- The key-first model does not preserve source strings as catalog identity.
- The client SDK alone does not provide Palamedes' PO-first extraction,
  compilation, and repo-owned workflow.
- Several differentiating workflows depend on a service and are therefore
  outside this public comparison.

## What it does differently

Tolgee makes an interactive client SDK the center of its developer experience.
Palamedes keeps translation catalogs and compilation in the repository and
treats framework runtime adapters as a thinner delivery layer.

## Sources

- https://github.com/tolgee/tolgee-js — accessed 2026-07-06
- https://github.com/tolgee/tolgee-js/blob/main/LICENSE — accessed 2026-07-06
- https://docs.tolgee.io/js-sdk — accessed 2026-07-06
- https://registry.npmjs.org/@tolgee/core/7.1.1 — accessed 2026-07-06
- https://registry.npmjs.org/@tolgee/react/7.1.1 — accessed 2026-07-06
