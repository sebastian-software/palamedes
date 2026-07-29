---
title: next-intl
category: frontend-framework
scope: oss-client-framework
subject: next-intl-runtime-and-build-tooling
license: MIT
analyzed: 2026-07-06
analyzed_versions: "next-intl 4.13.1; use-intl 4.13.1"
homepage: https://next-intl.dev
repository: https://github.com/amannn/next-intl
---

# next-intl

## Technical snapshot

| Fact | Value |
| --- | --- |
| Primary target | Next.js App Router |
| Message identity | Explicit keys |
| Message syntax | ICU MessageFormat |
| Catalogs | Locale JSON messages |
| Runtime | Server and client APIs with request-scoped configuration |
| Routing | Locale-aware navigation and middleware APIs |
| Extraction | Experimental `useExtracted` source transform |

next-intl integrates locale routing, request configuration, server rendering,
client hooks, dates/numbers, and ICU messages around Next.js conventions.
Server Components can format without shipping their message-loading logic to
the client; client components receive scoped messages through a provider.

The experimental extracted-message path compiles source-string authoring to
stable generated identifiers and catalogs. It is technically closer to
Palamedes than the default explicit-key JSON workflow, but remains an
experimental Next.js-specific surface in the analyzed version.

## What it does differently

next-intl treats Next.js request/routing integration as part of the i18n core.
Palamedes keeps message and catalog semantics host-neutral and implements
framework routing behavior in adapters/examples.

## Sources

- https://next-intl.dev/docs/usage/configuration — accessed 2026-07-06
- https://next-intl.dev/docs/routing — accessed 2026-07-06
- https://next-intl.dev/docs/usage/messages — accessed 2026-07-06
- https://next-intl.dev/blog/use-extracted — accessed 2026-07-06
- https://github.com/amannn/next-intl — accessed 2026-07-06
