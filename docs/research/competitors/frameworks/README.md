# Frameworks & libraries — overview

Pure technology: i18n libraries, frameworks, and compile-time tooling that
compete with the open-source core of Palamedes. Base snapshot date:
**2026-07-06**; the Paraglide column was refreshed **2026-08-16** and the
Tolgee JS dossier was refreshed **2026-08-17** (see each dossier's frontmatter
for exact analyzed versions; every fact below is sourced in the linked dossier).

Only the OSI-licensed client/framework surface is in scope. Commercial services
and platform behavior are intentionally excluded even when the same vendor
maintains an open-source SDK.

## Comparison table

| Fact                  | [Lingui](lingui.md)                  | [i18next](i18next.md)                       | [next-intl](next-intl.md)                     | [React Intl](react-intl.md)      | [Paraglide / inlang](paraglide-inlang.md)                  | [Vue I18n](vue-i18n.md)                    |
| --------------------- | ------------------------------------ | ------------------------------------------- | --------------------------------------------- | -------------------------------- | ---------------------------------------------------------- | ------------------------------------------ |
| License               | MIT                                  | MIT                                         | MIT                                           | BSD-3-Clause                     | MIT                                                        | MIT                                        |
| Version (analyzed)    | 6.5.0                                | 26.3.4                                      | 4.13.1                                        | 10.1.14                          | 2.23.2                                                     | 11.4.6                                     |
| Adoption (npm/wk · ★) | 1.29M · 5.8k                         | 18.2M · 8.6k                                | 4.0M · 4.3k                                   | 3.1M · 14.7k                     | 395k · 639                                                 | 3.24M · 2.7k (+7.2k archived)              |
| Framework support     | React/RSC, RN, Vue 3, Solid, vanilla | Agnostic core; React, Angular, Vue, Node, … | Next.js only (use-intl for React)             | React (no RSC); agnostic core    | React, Next.js, SvelteKit, TanStack, RR, Astro, Vue, Solid | Vue/Nuxt only                              |
| Message identity      | Source string or explicit ID         | Keys (explicitly not source-string)         | Keys; experimental source-string → hash keys  | Explicit or generated IDs        | Keys → compiled ESM functions                              | Keys                                       |
| ICU                   | Yes, native                          | Opt-in plugin (replaces native format)      | Yes, native                                   | Yes, native                      | Via plugin (ICU MF 1)                                      | Opt-in via bundler plugin; own DSL default |
| .po / gettext         | Yes, first-class                     | No (converters only)                        | Experimental only; msgid = hash               | No                               | No first-party plugin listed                               | No                                         |
| Extraction            | Static macros (Babel/SWC)            | i18next-cli (Rust/SWC)                      | Experimental build-time loader                | formatjs extract → compile (AST) | Compile-time codegen; IDE (Sherlock)                       | None first-party (IDE plugins)             |
| AI                    | Agent Skills + llms.txt; no MT       | None (in locize)                            | None; API designed for AI agents              | None                             | MT in ecosystem; .inlang for AI agents                     | None                                       |
| Standout              | Hard ESM-only v6 break; .po-first    | Runtime plugin architecture                 | Routing as core; Tailwind-inspired extraction | Intl polyfills; no RSC           | Zero runtime, tree-shaking; reload-on-switch               | SFC `<i18n>` blocks; AOT/JIT toggle        |

## Dossiers

- [lingui.md](lingui.md) — the closest architectural relative (macro extraction, .po-first, multi-framework)
- [i18next.md](i18next.md) — the adoption benchmark (18M downloads/week), key-based runtime model
- [next-intl.md](next-intl.md) — the Next.js default, converging on source-string extraction
- [react-intl.md](react-intl.md) — the ICU standard-bearer, structurally without RSC
- [paraglide-inlang.md](paraglide-inlang.md) — the compile-time/zero-runtime bet
- [vue-i18n.md](vue-i18n.md) — the Vue-ecosystem monopolist with its own DSL
- [intlayer.md](intlayer.md) — declaration instead of extraction, per-component co-located dictionaries
- [fluent.md](fluent.md) — the case against ICU itself; asymmetric localization, Mozilla-proven, effectively stalled on npm
- [typesafe-i18n.md](typesafe-i18n.md) — types as the product; ~1 kB, zero dependencies, no ICU or .po. **Dormant, and excluded from comparison pages** — see the handling note in the dossier
- [tolgee-js.md](tolgee-js.md) — MIT-licensed client runtime and framework bindings only; the associated TMS/platform is researched privately in Palamedes+
- [fbtee.md](fbtee.md) — Facebook FBT's modern continuation: inline source authoring, grammar-specific JSX primitives, hashed JSON catalogs, and Babel/SWC compilation

Note: the `intlayer`, `fluent` and `typesafe-i18n` dossiers were added
2026-07-26, `fbtee` was added 2026-08-14, Paraglide was refreshed 2026-08-16,
and Tolgee JS was refreshed 2026-08-17, so their `analyzed` dates differ from
the 2026-07-06 snapshot shared by the others. The broad framework table above
has not been re-run against the added dossiers, Tolgee JS, or fbtee. fbtee is
included separately in the checked end-to-end workflow benchmark.
