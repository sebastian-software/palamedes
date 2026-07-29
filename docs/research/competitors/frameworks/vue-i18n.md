---
title: Vue I18n (Intlify)
category: frontend-framework
scope: oss-client-framework
subject: vue-i18n-runtime-and-build-tooling
license: MIT
analyzed: 2026-07-06
analyzed_versions: "vue-i18n 11.4.6; @intlify/unplugin-vue-i18n; @nuxtjs/i18n 10.4.0"
homepage: https://vue-i18n.intlify.dev
repository: https://github.com/intlify/vue-i18n
---

# Vue I18n (Intlify)

## Technical snapshot

| Fact             | Value                                                 |
| ---------------- | ----------------------------------------------------- |
| Message identity | Explicit keys                                         |
| Message syntax   | Vue I18n message syntax                               |
| Runtime          | Vue plugin with Composition and legacy APIs           |
| Catalogs         | JavaScript/JSON/YAML and SFC `<i18n>` blocks          |
| Compilation      | Runtime JIT or build-time AOT with the unplugin       |
| ICU              | Optional support through tooling; not the default DSL |
| PO               | No native PO workflow                                 |

Vue I18n integrates locale state, message lookup, plurals, dates, and numbers
with Vue reactivity. Messages can be global or component-local, including
single-file-component `<i18n>` blocks. The bundler plugin can precompile
messages, remove the runtime compiler, and support stricter CSP deployments.

Nuxt integration adds locale routing, lazy resource loading, and server/client
configuration around the same runtime model.

## What it does differently

Vue I18n treats reactive Vue integration and component-local resources as core
capabilities. Palamedes keeps catalog semantics outside the framework and
delivers Vue behavior through the same host-adapter architecture used for other
frameworks.

## Sources

- https://vue-i18n.intlify.dev/guide/ — accessed 2026-07-06
- https://vue-i18n.intlify.dev/guide/advanced/sfc — accessed 2026-07-06
- https://vue-i18n.intlify.dev/guide/advanced/optimization — accessed 2026-07-06
- https://github.com/intlify/vue-i18n — accessed 2026-07-06
- https://i18n.nuxtjs.org — accessed 2026-07-06
