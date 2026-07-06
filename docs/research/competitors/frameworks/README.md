# Frameworks & libraries — overview

Pure technology: i18n libraries, frameworks, and compile-time tooling that
compete with the open-source core of Palamedes. Snapshot date: **2026-07-06**
(see each dossier's frontmatter for exact analyzed versions; every fact below
is sourced in the linked dossier).

## Comparison table

| Fact                  | [Lingui](lingui.md)                  | [i18next](i18next.md)                       | [next-intl](next-intl.md)                     | [FormatJS / react-intl](formatjs-react-intl.md) | [Paraglide / inlang](paraglide-inlang.md)                  | [Vue I18n](vue-i18n.md)                    |
| --------------------- | ------------------------------------ | ------------------------------------------- | --------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------ |
| License               | MIT                                  | MIT                                         | MIT                                           | BSD-3-Clause                                    | MIT                                                        | MIT                                        |
| Version (analyzed)    | 6.5.0                                | 26.3.4                                      | 4.13.1                                        | 10.1.14                                         | 2.20.2                                                     | 11.4.6                                     |
| Company / funding     | Community, Open Collective           | Core team, funded by own SaaS (locize)      | Single maintainer, GitHub Sponsors            | Community (ex-Yahoo), ~1 maintainer             | Opral GmbH (~7 people, unfunded)                           | kazupon (part-time), sponsors              |
| Pricing               | Free OSS                             | Free OSS (paid TMS: locize)                 | Free OSS                                      | Free OSS                                        | Free OSS, no monetization                                  | Free OSS                                   |
| Adoption (npm/wk · ★) | 1.29M · 5.8k                         | 18.2M · 8.6k                                | 4.0M · 4.3k                                   | 3.1M · 14.7k                                    | 358k · 538                                                 | 3.24M · 2.7k (+7.2k archived)              |
| Framework support     | React/RSC, RN, Vue 3, Solid, vanilla | Agnostic core; React, Angular, Vue, Node, … | Next.js only (use-intl for React)             | React (no RSC), Vue; agnostic core              | React, Next.js, SvelteKit, TanStack, RR, Astro, Vue, Solid | Vue/Nuxt only                              |
| Message identity      | Source string or explicit ID         | Keys (explicitly not source-string)         | Keys; experimental source-string → hash keys  | Content-hash of default message                 | Keys → compiled ESM functions                              | Keys                                       |
| ICU                   | Yes, native                          | Opt-in plugin (replaces native format)      | Yes, native                                   | Yes, native                                     | Via plugin (ICU MF 1)                                      | Opt-in via bundler plugin; own DSL default |
| .po / gettext         | Yes, first-class                     | No (converters only)                        | Experimental only; msgid = hash               | No                                              | No plugin found                                            | No                                         |
| Extraction            | Static macros (Babel/SWC)            | i18next-parser / new Rust i18next-cli       | Experimental build-time loader                | formatjs extract → compile (AST)                | Compile-time codegen; IDE (Sherlock)                       | None first-party (IDE plugins)             |
| AI                    | Agent Skills + llms.txt; no MT       | None (in locize)                            | None; API designed for AI agents              | None                                            | MT in ecosystem; .inlang for AI agents                     | None                                       |
| Standout              | Hard ESM-only v6 break; .po-first    | Runtime plugin architecture                 | Routing as core; Tailwind-inspired extraction | Intl polyfills; no RSC                          | Zero runtime, tree-shaking; reload-on-switch               | SFC `<i18n>` blocks; AOT/JIT toggle        |

## Dossiers

- [lingui.md](lingui.md) — the closest architectural relative (macro extraction, .po-first, multi-framework)
- [i18next.md](i18next.md) — the adoption benchmark (18M downloads/week), key-based runtime model
- [next-intl.md](next-intl.md) — the Next.js default, converging on source-string extraction
- [formatjs-react-intl.md](formatjs-react-intl.md) — the ICU standard-bearer, structurally without RSC
- [paraglide-inlang.md](paraglide-inlang.md) — the compile-time/zero-runtime bet
- [vue-i18n.md](vue-i18n.md) — the Vue-ecosystem monopolist with its own DSL
