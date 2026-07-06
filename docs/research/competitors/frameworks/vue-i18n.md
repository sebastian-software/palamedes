---
title: Vue I18n (Intlify)
category: frontend-framework
analyzed: 2026-07-06
analyzed_versions: "vue-i18n 11.4.6 (npm latest, published 2026-06-18); 12.0.0-alpha.4 (npm 'next' tag, 2026-05-17); @intlify/unplugin-vue-i18n (current, per docs, no separate version pinned); @nuxtjs/i18n / nuxt-modules/i18n v10.4.0 (2026-05)"
homepage: https://vue-i18n.intlify.dev
repository: https://github.com/intlify/vue-i18n
---

# Vue I18n (Intlify)

## Fact sheet

| Fact              | Value                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------- |
| License           | MIT                                                                                         |
| Analyzed version  | vue-i18n 11.4.6 (2026-06-18)                                                                |
| Company / funding | kazupon (Vue core team member), part-time; GitHub Sponsors / backers                        |
| Pricing           | Free OSS                                                                                    |
| Adoption          | ~3.24M npm downloads/week; 2.7k GitHub stars (+7.2k on archived Vue-2 repo)                 |
| Framework support | Vue 2/3 + Nuxt (via separately maintained @nuxtjs/i18n) only                                |
| Message identity  | Key-based                                                                                   |
| ICU MessageFormat | Opt-in via bundler plugin; own non-ICU DSL is the default                                   |
| .po / gettext     | No — JSON/JSON5/YAML/JS resources                                                           |
| Extraction        | No first-party CLI; IDE-plugin-driven (i18n Ally)                                           |
| AI                | None                                                                                        |
| Notable           | SFC `<i18n>` blocks; AOT-vs-JIT compile toggle (CSP); official `petite-vue-i18n` lite build |

## Snapshot

- Maintainer / company / funding: Created and led by kazuya kawaguchi ("kazupon"), a Vue.js core team member; project now lives under the "Intlify" org/project umbrella (a collection of Vue-focused i18n tooling: vue-i18n, petite-vue-i18n, unplugin-vue-i18n, eslint-plugin-vue-i18n, vue-i18n-routing, etc.). No corporate employer backing found — funded via GitHub Sponsors (github.com/sponsors/kazupon) and an OpenCollective/BACKERS.md tiered-sponsor list (Platinum/Gold/Silver/Bronze). Not verified whether sponsorship income is large enough to fund full-time work; kazupon has stated he works on it "partially part-time" alongside a day job.
- License: MIT.
- Current stable version + release date: **11.4.6**, published 2026-06-18 (per npm registry `time` field). A **12.0.0-alpha.4** prerelease exists on the `next` dist-tag (published 2026-05-17), targeting Vue 3 Vapor Mode compatibility and automatic `Intl.PluralRules`-based pluralization.
- Adoption:
  - npm weekly downloads (vue-i18n): **3,242,077** for the week of 2026-06-29–2026-07-05 (api.npmjs.org).
  - GitHub stars: **2,701** on the current `intlify/vue-i18n` repo (the Vue-3-era rewrite, created 2020-01-05). The **original** Vue-2-era repo, `kazupon/vue-i18n`, is archived and separately carries **7,227 stars** — total mindshare/history is split across two repos, which understates apparent popularity if only the active repo is checked.
  - Nuxt integration (`@nuxtjs/i18n`, repo `nuxt-modules/i18n`): 2,067 GitHub stars, 245 releases, latest v10.4.0 (~May 2026); maintained by the separate "nuxt-modules" org, not Intlify directly, though closely coordinated.
  - Forks: 383; open issues: 90 (intlify/vue-i18n, as of 2026-07-06).
- First release / age: Original `vue-i18n` (Vue 2) dates to ~2016 (npm package `vue-i18n` itself was first published 2014-05-04 per registry `created`, though early versions predate the mature API). The current `intlify/vue-i18n` (Vue 3 rewrite, "vue-i18n-next") repo was created 2020-01-05 — roughly 6 years old as the actively maintained codebase; ~10 years of lineage overall.

## Positioning & target audience

- The de facto standard i18n plugin for Vue.js — analogous position to react-intl/i18next in the React world, but Vue-official-adjacent (maintainer is a Vue core team member, docs are hosted in the Vue ecosystem's style, listed on vuejs.org's ecosystem links).
- Targets Vue 2 and Vue 3 app developers directly, plus Nuxt developers via the separate `@nuxtjs/i18n` wrapper module.
- Positions itself as covering the full spread from small SPAs (via the lightweight `petite-vue-i18n` variant) to large enterprise apps (via SFC-scoped local messages, message compilation/precompilation, and datetime/number formatting).

## Core concepts & architecture

- **Key-based messages, custom (non-ICU) message format**: Messages are addressed by arbitrary string keys (e.g. `message.hello`) resolving to hierarchical JSON/YAML objects, not source-string-as-key. The interpolation/pluralization syntax is Vue I18n's own DSL, not ICU MessageFormat:
  - Named interpolation: `{msg}`; list interpolation: `{0}`; literal escaping via single quotes: `{'@'}`.
  - **Linked messages**: `@:key` syntax lets one message embed/reference another by key, with built-in modifiers `@.upper:`, `@.lower:`, `@.capitalize:` (plus custom modifiers registrable via `createI18n({ modifiers })`).
  - Legacy Rails-style `%{var}` interpolation existed for migration purposes but is deprecated since v10.
  - Pluralization is rule-based (custom plural selector functions or, in the 12.0.0-alpha line, `Intl.PluralRules`-driven automatic pluralization) rather than ICU's `plural`/`select`/`selectordinal` keywords.
  - **ICU mode does exist but is opt-in and build-tool-gated**: `@intlify/unplugin-vue-i18n` can be configured with an `icu: true`-style option to parse ICU MessageFormat strings at build time — this is a bolt-on, not the native runtime format, and is coupled to using the bundler plugin (i.e., unavailable without a build step).
- **SFC `<i18n>` custom blocks**: Locale messages can be declared inline inside a `.vue` file's own custom block (JSON/YAML/JSON5), scoping messages to that component ("local scope") rather than only using a global message object. Requires a bundler plugin (`@intlify/unplugin-vue-i18n` for Vite/webpack/Rspack, or `@intlify/vue-i18n-loader` for Quasar) to parse/inject the block — the custom block is otherwise inert without tooling support.
- **Message pre-compilation via bundler plugin**: `@intlify/unplugin-vue-i18n` precompiles locale message resources (json/json5/yaml/yml/js/ts) into optimized JS functions or AST at build time, avoiding runtime string-parsing cost; also provides a virtual module (`@intlify/unplugin-vue-i18n/messages`) to import all locale messages in one go, and auto-selects dev vs. prod vue-i18n builds.
- **AOT vs JIT compilation**: Two runtime compilation strategies — AOT (build-time, uses `eval`/`new Function`, historically the default) vs **JIT (v9.3+, default since v10)**, which compiles message strings on demand without `eval`. JIT was introduced specifically to fix CSP (`unsafe-eval`) violations and to allow tree-shaking the message compiler out of the bundle (`__INTLIFY_DROP_MESSAGE_COMPILER__` flag) when messages are pre-compiled by the bundler plugin instead.
- **Composition API vs Legacy API**: `useI18n()` (Composition API, Vue 3 idiomatic, supports "legacy: false" mode with different `t()`/`$t` overload signatures) vs. the older Options-API-style global `this.$t`/`this.$i18n` ("Legacy API," modeled on the Vue 2 API surface for migration continuity). **Legacy API mode is deprecated starting v11 and slated for full removal in v12** — a multi-year API-surface migration for existing consumers.
- **Type safety**: TypeScript support (v9.2+) infers a `MessageSchema` type from a source locale's JSON/TS resource object (`type MessageSchema = typeof enUS`) and uses it to type-check that other locales match the same shape, and to constrain `t()`/`$t()` key arguments to keys that exist in the schema. This is inference-based (no separate codegen step) but requires either importing typed resource modules or hand-authoring `declare module` global-schema augmentation; per-component (SFC-local) schemas are also supported.

## Framework & platform support

- **Vue 2 and Vue 3**: separate major-version compatible lines (v8 targets Vue 2 legacy support via `vue-i18n-bridge` for gradual migration; v9+ targets Vue 3).
- **Nuxt**: not built into vue-i18n itself — handled by the separately maintained `@nuxtjs/i18n` (nuxt-modules org) module, which adds routing localization (localized routes/prefixes), lazy-loaded per-locale translation chunks, and SEO meta-tag helpers on top of vue-i18n's core runtime.
- **petite-vue-i18n**: an official lighter-weight distribution/entry-point that strips down to translation-only (`t`/`$t`) functionality — removes datetime/number formatting APIs (`d`/`$d`, `n`/`$n`), the `v-t` directive, built-in formatting components, Legacy/Options API support, and hierarchical (nested) message structures (flat key-value only by default). Claimed size reduction: ~32% smaller (runtime+compiler) or ~45% smaller (runtime-only) vs. full vue-i18n; brotli size ~9.61KB vs ~14.18KB for the runtime+compiler build.
- No official first-class support found for non-Vue frameworks — this is a Vue/Nuxt-only ecosystem tool, unlike Palamedes' explicit multi-framework runtime (Next.js, TanStack Start, SolidStart, Waku, React Router, Vite, backend servers) which spans multiple UI frameworks with one model.
- Quasar Framework has its own loader (`@intlify/vue-i18n-loader`) for SFC blocks, indicating some meta-framework-specific tooling fragmentation beyond just Nuxt.

## Catalog formats & interop

- Native resource formats: JSON, JSON5, YAML/YML, or JS/TS modules exporting message objects — not `.po`/gettext. No built-in gettext/`.po` catalog support was found in official docs.
- SFC `<i18n>` blocks default to JSON but accept YAML/JSON5 via the `lang` attribute.
- No built-in TMS (translation management system) integrations or format adapters (contrast with FormatJS, which ships formatter adapters for Crowdin/Lokalise/Phrase); interop with TMS platforms in the wild is typically done by treating the JSON/YAML resource files as the sync target for third-party tools (e.g., i18n Ally VS Code extension, or external platforms like Localazy/Phrase syncing flat or nested JSON).
- No source-string-as-key model — Vue I18n requires developers to invent and maintain a separate key namespace (e.g. `message.hello`) distinct from the actual displayed string, unlike Palamedes' source-string-first `.po` approach.

## Workflow & tooling

- `@intlify/unplugin-vue-i18n`: primary build tool — precompilation, SFC block parsing, virtual message modules, automatic dev/prod build selection; supports Vite, webpack, Rspack, and Nuxt.
- `@intlify/eslint-plugin-vue-i18n`: lint rules for message-key hygiene inside Vue templates/SFCs.
- `vue-i18n-extensions` and community VS Code tooling (i18n Ally) provide extraction/inline-preview support; no first-party CLI extraction tool equivalent to `formatjs extract` was found — message key discovery is largely IDE-plugin-driven rather than a project CLI command.
- `vue-i18n-routing` / `@nuxtjs/i18n`: routing localization (locale-prefixed routes, per-locale lazy chunk loading) — bundled with the Nuxt module rather than vue-i18n core.

## AI features

- None found in vue-i18n, unplugin-vue-i18n, or the Nuxt i18n module docs. No AI-assisted translation, AI-based extraction, or LLM integration mentioned anywhere in official documentation or the GitHub org. Purely a traditional manual/TMS-driven translation workflow.

## Pricing

- Fully free and open source (MIT). No paid tier, hosted service, or commercial product from Intlify itself. Revenue model, to the extent one exists, is voluntary sponsorship (GitHub Sponsors / OpenCollective-style backers listed in BACKERS.md), not a product/SaaS.

## Strengths

- Extremely high adoption for the Vue ecosystem specifically (~3.24M weekly npm downloads), effectively unrivaled as "the" Vue i18n library.
- Deep Vue-native integration: directive (`v-t`), formatting components, SFC custom blocks, Composition + Options API support, and framework-idiomatic type inference.
- Flexible compilation strategy (AOT vs JIT) giving developers an explicit lever between best runtime performance (precompiled) and CSP-compliance/dynamic-content flexibility (JIT, no `eval`).
- `petite-vue-i18n` gives a genuine lightweight opt-out path for bundle-size-sensitive projects that only need basic `t()` calls.
- Long track record and Vue-core-team maintainer credibility; tight (if organizationally separate) coordination with the Nuxt ecosystem via `@nuxtjs/i18n`.
- Optional ICU MessageFormat parsing via the bundler plugin for teams that want standards-based message syntax without leaving the Vue I18n runtime.

## Weaknesses & criticism

- **Bundle-size / tree-shaking complaints**: community reports (e.g. GitHub discussion intlify/vue-i18n#1769) describe global JSON message files bundling all keys into the root bundle regardless of which components use them — one user reported ~160KB (~50KB gzip) added for ~2,000 keys across 2 locales; no built-in per-route/per-component tree-shaking of unused translation keys.
- **CSP (`unsafe-eval`) friction**: pre-v9.3 AOT compilation relied on `eval`/`new Function`, breaking strict Content-Security-Policy setups (kazupon/vue-i18n#1431); resolved only by switching to JIT compilation (default since v10) or manually configuring runtime-only + JIT build flags — earlier versions required nontrivial bundler configuration to work under strict CSP.
- **Custom (non-ICU) message syntax by default**: proprietary interpolation/pluralization/linked-message DSL rather than the industry-standard ICU MessageFormat used by react-intl/FormatJS; ICU is only available as an opt-in, build-tool-gated mode, not the native/default runtime format.
- **Legacy API deprecation churn**: Options-API-style Legacy API is deprecated in v11 and will be fully removed in v12 — teams that adopted the Options API pattern face a forced migration to the Composition API (`useI18n()`) to stay current, on top of earlier v9→v10 breaking changes (removal of `%{}` modulo interpolation, `tc`/`$tc` deprecation).
- **No source-string-first workflow**: requires maintaining separate translation keys distinct from source text, which is a structural (not just tooling) divergence from gettext/`.po`-style source-string-as-key systems like Palamedes.
- **Vue/Nuxt-only scope**: no path to a shared runtime across other frameworks — a team using both Vue and, say, React or a meta-framework outside the Vue ecosystem gets no code/model reuse from Vue I18n at all.
- **Tooling fragmentation across two orgs**: Nuxt support lives in a separately maintained repo (`nuxt-modules/i18n`) with its own release cadence and versioning, rather than being a first-party Intlify deliverable — coordination/version-compatibility between vue-i18n and `@nuxtjs/i18n` is an extra thing to track.
- **Sponsorship-dependent, thin core team**: maintenance appears concentrated around one primary maintainer (kazupon) working part-time per his own public statements; not verified whether this constitutes a bus-factor risk in practice, but no evidence of a larger, funded core team.

## What they do differently

- Ships **two parallel compilation strategies (AOT vs JIT)** as an explicit, switchable tradeoff between runtime performance and CSP/dynamic-content compatibility — most competitors pick one strategy rather than exposing this as a first-class toggle.
- **SFC-scoped `<i18n>` custom blocks** let translations live physically inside the same `.vue` file as the component markup/logic — a genuinely Vue-specific colocation model with no direct equivalent in React/Solid-ecosystem tools (which colocate via hooks/JSX components instead of a distinct SFC block type).
- Offers a **deliberately smaller sibling package (`petite-vue-i18n`)** as an official, maintained "lite" distribution rather than leaving bundle-size optimization entirely to userland forks or manual tree-shaking config.
- **Linked messages (`@:key` with built-in case modifiers)** are a distinctive DSL feature for composing one message out of another — not something ICU MessageFormat or gettext natively expresses.
- Treats **ICU MessageFormat as an optional, build-tool-gated import** rather than the native syntax — the inverse of FormatJS's ICU-native design, reflecting a "Vue-ecosystem-DSL first, standards-format opt-in" philosophy.
- **Type inference from a single source-locale resource object** (`typeof enUS`) drives cross-locale shape-checking and `t()` key typing without a separate codegen or extraction step — lighter-weight than tools requiring a build-time type-generation pass, but it also means type safety is only as strong as whichever locale file is chosen as the schema source.
- Splits its own history/reputation across **two separate GitHub repos** (archived Vue-2-era `kazupon/vue-i18n` at 7.2k stars vs. active Vue-3-era `intlify/vue-i18n` at 2.7k stars) — a project-identity discontinuity from the Vue 2→3 rewrite that dilutes the visible popularity signal on the currently maintained repo.

## Sources

- https://registry.npmjs.org/vue-i18n/latest (accessed 2026-07-06)
- https://registry.npmjs.org/vue-i18n (full registry, `time` field for version history) (accessed 2026-07-06)
- https://api.npmjs.org/downloads/point/last-week/vue-i18n (accessed 2026-07-06)
- https://api.github.com/repos/intlify/vue-i18n (accessed 2026-07-06)
- https://api.github.com/repos/kazupon/vue-i18n (accessed 2026-07-06)
- https://api.github.com/repos/nuxt-modules/i18n (accessed 2026-07-06)
- https://github.com/intlify/vue-i18n (accessed 2026-07-06)
- https://github.com/intlify/vue-i18n/releases (accessed 2026-07-06)
- https://github.com/nuxt-modules/i18n (accessed 2026-07-06)
- https://vue-i18n.intlify.dev/guide/ (accessed 2026-07-06)
- https://vue-i18n.intlify.dev/guide/essentials/syntax (accessed 2026-07-06)
- https://vue-i18n.intlify.dev/guide/advanced/sfc (accessed 2026-07-06)
- https://vue-i18n.intlify.dev/guide/advanced/optimization (accessed 2026-07-06)
- https://vue-i18n.intlify.dev/guide/advanced/typescript (accessed 2026-07-06)
- https://vue-i18n.intlify.dev/guide/advanced/lite (accessed 2026-07-06)
- https://vue-i18n.intlify.dev/guide/migration/breaking (accessed 2026-07-06)
- https://vue-i18n.intlify.dev/guide/migration/breaking10 (accessed 2026-07-06)
- https://vue-i18n.intlify.dev/guide/migration/breaking11 (accessed 2026-07-06)
- https://github.com/intlify/bundle-tools/tree/main/packages/unplugin-vue-i18n (accessed 2026-07-06)
- https://github.com/intlify/vue-i18n-next/blob/master/BACKERS.md (accessed 2026-07-06)
- https://github.com/sponsors/kazupon (accessed 2026-07-06)
- https://github.com/intlify/vue-i18n/discussions/1769 "Different approaches for i18n of large applications?" (accessed 2026-07-06)
- https://github.com/kazupon/vue-i18n/issues/1431 "CSP issue while we make use of useI18n()" (accessed 2026-07-06)
- https://github.com/DivanteLtd/vue-storefront/issues/4813 "Reduce initial client-side bundle-size by lazy-loading i18n translations" (accessed 2026-07-06)
