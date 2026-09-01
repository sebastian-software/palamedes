# Changelog

<!--
  Everything in this first section is hand-maintained; release-please owns every
  version section below it and never rewrites this one. That is why it must not
  be labeled "Unreleased": the label never expires on its own, so it kept
  telling upgraders that shipped behavior changes were still pending.
  When a note here is no longer worth carrying, delete it.
-->

## Behavior Notes (1.x)

Changes across the 1.x line that need more context than a release entry gives.
All of them have shipped; the version sections below record the release each one
landed in.

### Compatibility Notes

- `@palamedes/solid` now targets Solid 2 (`2.0.0-rc.3` or newer) and no longer
  supports Solid 1. The Solid examples use Solid 2 Start Mode directly through
  `@solidjs/vite-plugin`; the retired predecessor integration and its example
  names have been removed.
- First-party host adapters preserve inline source-message fallbacks in macro
  and MDX output by default in both development and production. Set
  `keepSourceFallbacks: false` for compact, hash-only output when bundle size or
  embedding authored source text is a concern. The low-level transform retains
  its stripped default (`keepSourceFallbacks: false`);
  `stripMessageField` remains as a deprecated inverse compatibility option.
  Production host adapters also remove translator comments and context metadata
  from generated runtime descriptors; development keeps them for diagnostics.
- `createI18n()` now starts with `DEFAULT_LOCALE` (`"en"`), so `onMissing` can
  report default-locale misses before the first `load()` or `activate()` call.
- Custom `I18nInstance` implementations must expose an initialized
  `locale: string`; implementations that omitted the property or declared it as
  optional need to update.
- Plural and selectordinal arguments now require a present, numeric value
  (numeric strings still work). A missing or non-finite value throws instead of
  silently coercing to `0` and matching `=0`/`zero` branches; inside
  `_()`/`getMessage()` the error is reported through `onError` and rendering
  falls back to the source message.
- Host-carrying URLs from `canonicalUrl()` and `suggest()` are now
  protocol-relative (`//host/path`) instead of hardcoding `http://`. Set the
  new `protocol` option in `defineLocaleControls` for absolute URLs.
- The runtime `Plural`/`Select`/`SelectOrdinal` components in
  `@palamedes/react` and `@palamedes/solid` now resolve through the active
  i18n instance (catalog entries keyed by the synthesized source pattern are
  honored), normalize `_N` exact-match props to ICU `=N` like the macro
  transform, and reject invalid option props or option text with unbalanced
  braces instead of silently misrendering.
- React and Solid use the new executable-message hook when available and retain
  the previous node-rendering path for older or custom `PalamedesI18n`
  implementations that do not expose it.
- `<Trans>` variable values that are `Date` instances now render as
  deterministic ISO strings (matching `i18n._`), fixing SSR hydration
  mismatches across time zones.
- `pmds report` now counts PO entries flagged `fuzzy` as untranslated and
  reports them in a separate `fuzzy` column, matching gettext conventions.
  Completeness percentages can drop accordingly.
- Palamedes data configs now reject camelCase spellings of known keys
  (`sourceLocale`, `pseudoLocale`, `fallbackLocales`, `sourceReferenceRoot`)
  with a kebab-case hint instead of silently ignoring them, and
  fallback-locale entries must reference configured locales. The native CLI
  reports `palamedes.config.ts`/`.js` files with a specific error instead of
  a generic not-found.
- `Accept-Language` entries with `q=0` are treated as "not acceptable" per
  RFC 9110 and no longer participate in locale negotiation.
- The Vite and Next `.po` loaders report catalog diagnostics through the
  bundler's warning channel (`this.warn` / `emitWarning`) instead of
  `console.warn`.
- The per-package `CHANGELOG.md` files (stale since the 0.6.x per-package
  release era) now point at this root changelog.
- `@palamedes/next-plugin` now declares `next ^16` as its peer range. The
  previously declared `^13 || ^14 || ^15` never worked with the emitted
  top-level `turbopack.rules`/`outputFileTracingRoot` config; on those
  versions the Turbopack transform silently never ran.
- The Next plugin's `include`/`exclude` options now also apply under
  Turbopack (translated into the rule condition), user-supplied
  `turbopack.rules` for the same glob are appended to instead of overwritten,
  and the macro content pre-filter is derived from the canonical macro
  package list (it previously missed `@palamedes/solid/macro`).

### Performance Improvements

- Next.js Client Components can now opt into automatic graph-split PO loading
  with `messageSplitting: true`. Turbopack and webpack load only the active
  document locale's compiled fragments for the evaluated client module graph,
  including fragments discovered by later client navigation, without an
  application-owned catalog boundary or RSC serialization of executable
  messages.
- Next.js Server Functions now compile per-source message fragments and follow
  the server ESM graph through locale-specific lazy imports. Action requests
  load only the active locale's fragments for evaluated action modules and
  transitive helpers instead of copying the complete locale catalog.
- React and Solid now share one internal message renderer between their root
  and `compiled` entrypoints. This removes parallel runtime implementations
  while preserving the parser-free production boundary; lazy raw patterns use
  a parse-only Core capability instead of re-entering catalog lookup.
- Generated catalogs, transformed `Trans` components, and compiled MDX now use
  parser-free `compiled` package entrypoints. The real Vite MDX production
  proof drops from 214.65 kB to 209.25 kB raw JavaScript and from 68.28 kB to
  66.67 kB gzip; `pnpm benchmark:runtime-browser` guards the boundary. Package
  roots retain lazy parsing for hand-written ICU string catalogs.
- Generated PO and FCL catalog modules now emit one map of constant strings and
  executable message functions. Valid dynamic messages bypass browser ICU
  parsing and AST interpretation; manual and invalid string catalogs retain the
  bounded lazy parser and existing fallback behavior. Native and TypeScript
  entry points share one Ferrocat-backed code generator.

## [1.21.0](https://github.com/sebastian-software/palamedes/compare/palamedes-v1.20.0...palamedes-v1.21.0) (2026-09-01)


### Features

* **remix:** add compiled rich message runtime ([a55792c](https://github.com/sebastian-software/palamedes/commit/a55792c7711916e9c33bcd3a4e04666e1298a61b))

## [1.20.0](https://github.com/sebastian-software/palamedes/compare/palamedes-v1.19.0...palamedes-v1.20.0) (2026-09-01)


### Features

* **remix:** transform browser assets ([#1051](https://github.com/sebastian-software/palamedes/issues/1051)) ([d28eb4a](https://github.com/sebastian-software/palamedes/commit/d28eb4a0177bfb0c62d6038eb2935dd80b7b3d04))

## [1.19.0](https://github.com/sebastian-software/palamedes/compare/palamedes-v1.18.1...palamedes-v1.19.0) (2026-09-01)


### Features

* **site:** show build metadata in footer ([#1041](https://github.com/sebastian-software/palamedes/issues/1041)) ([c213614](https://github.com/sebastian-software/palamedes/commit/c21361419040ef47d0f619b894a282861a93be8f))


### Bug Fixes

* **cli:** bound binary plugin protocol resources ([#1049](https://github.com/sebastian-software/palamedes/issues/1049)) ([fc83ccc](https://github.com/sebastian-software/palamedes/commit/fc83ccce552b1b16d1e41e3eb2743fe75dbf54e2))
* **cli:** canonicalize watch mode paths ([#1050](https://github.com/sebastian-software/palamedes/issues/1050)) ([fbb768e](https://github.com/sebastian-software/palamedes/commit/fbb768e3a3e3cd5c4d65f4adad5d30188b7233ca))
* **config:** align metadata validation across loaders ([#1048](https://github.com/sebastian-software/palamedes/issues/1048)) ([72d429c](https://github.com/sebastian-software/palamedes/commit/72d429c1e8abd3e1fb9c787c28aaf3110894c829))

## [1.18.1](https://github.com/sebastian-software/palamedes/compare/palamedes-v1.18.0...palamedes-v1.18.1) (2026-08-28)


### Bug Fixes

* keep frameworks live smoke content-agnostic ([#1045](https://github.com/sebastian-software/palamedes/issues/1045)) ([d757934](https://github.com/sebastian-software/palamedes/commit/d757934803e2745c218e098c2b7489a0a180c73d))
* reflect live example hosts and unblock site deploys ([#1043](https://github.com/sebastian-software/palamedes/issues/1043)) ([00a47c0](https://github.com/sebastian-software/palamedes/commit/00a47c00f375127d88c81b1160f807c46809051b))
* register Effective Flow setup as ADR-028 ([#1042](https://github.com/sebastian-software/palamedes/issues/1042)) ([b947906](https://github.com/sebastian-software/palamedes/commit/b9479063f10e96a836d71aaf2535ffa70b733b7c))
* **runtime:** preserve edge worker server scopes ([#1038](https://github.com/sebastian-software/palamedes/issues/1038)) ([e9f0951](https://github.com/sebastian-software/palamedes/commit/e9f0951ea5a128b307bb87cb94fd9a302a77b43e))

## [1.18.0](https://github.com/sebastian-software/palamedes/compare/palamedes-v1.17.3...palamedes-v1.18.0) (2026-08-27)


### Features

* **cli:** prepare privacy-bounded update checks ([#973](https://github.com/sebastian-software/palamedes/issues/973)) ([01107a4](https://github.com/sebastian-software/palamedes/commit/01107a4cdedef7136bf630fce925afa4047fcbd4))
* **node:** add async catalog APIs ([#950](https://github.com/sebastian-software/palamedes/issues/950)) ([3341495](https://github.com/sebastian-software/palamedes/commit/3341495c35f6111ad6ec7e72086616947563b25e))
* **packaging:** add Intel macOS and Windows ARM targets ([#948](https://github.com/sebastian-software/palamedes/issues/948)) ([06a7544](https://github.com/sebastian-software/palamedes/commit/06a754434c1351559d1515e06b97502ef6842be6))
* **site:** clarify navigation decision paths ([#951](https://github.com/sebastian-software/palamedes/issues/951)) ([d34dba3](https://github.com/sebastian-software/palamedes/commit/d34dba31c1d55ff12a2ebe6d26fae7bdfb7db2ed))
* **site:** expose TLD rollout links ([#1037](https://github.com/sebastian-software/palamedes/issues/1037)) ([a34cf3e](https://github.com/sebastian-software/palamedes/commit/a34cf3e3f0d0f8535e6ac6f49c1a4fec302eb4ac))
* **site:** finish proof artifact contract ([#954](https://github.com/sebastian-software/palamedes/issues/954)) ([988efbb](https://github.com/sebastian-software/palamedes/commit/988efbb2b2a837ab48ec1abe39ec5eed1b4edbf5))
* **site:** organize generated documentation navigation ([#953](https://github.com/sebastian-software/palamedes/issues/953)) ([66771b5](https://github.com/sebastian-software/palamedes/commit/66771b573a690af19684fbef3e89ccb47b3d2e04))
* **site:** strengthen comparison decisions ([#952](https://github.com/sebastian-software/palamedes/issues/952)) ([6074116](https://github.com/sebastian-software/palamedes/commit/60741166ee9805d6fc8ed25c3c7936b031d43710))
* **solid:** migrate integration and examples to Solid 2 ([#1024](https://github.com/sebastian-software/palamedes/issues/1024)) ([919b0d7](https://github.com/sebastian-software/palamedes/commit/919b0d7e80931e0c629d2fd4cb5b7c81a04d6c00))
* update deps ([32a3e2a](https://github.com/sebastian-software/palamedes/commit/32a3e2a2aede0bbd760a007742e168142e45dc95))


### Bug Fixes

* **adapters:** retain production source fallbacks ([#938](https://github.com/sebastian-software/palamedes/issues/938)) ([a95d7f9](https://github.com/sebastian-software/palamedes/commit/a95d7f9ed7aed851e4bac1338dd3483b16c9a93c))
* **cli:** align source discovery and watch matching ([#1033](https://github.com/sebastian-software/palamedes/issues/1033)) ([4c44ad6](https://github.com/sebastian-software/palamedes/commit/4c44ad6b294245dab1cf5634ff8619b109d2305e))
* **cli:** distinguish audit and report policy exits ([#941](https://github.com/sebastian-software/palamedes/issues/941)) ([cc2a26d](https://github.com/sebastian-software/palamedes/commit/cc2a26d58c9bf019a42e11f8e2fb3d9ec680f2b9))
* **cli:** fail reserved placeholder bins ([#942](https://github.com/sebastian-software/palamedes/issues/942)) ([1ac25ae](https://github.com/sebastian-software/palamedes/commit/1ac25ae2dc5ece3744e42859d68c18eaeb54db18))
* **cli:** forward SIGHUP to native process groups ([#940](https://github.com/sebastian-software/palamedes/issues/940)) ([79fbf15](https://github.com/sebastian-software/palamedes/commit/79fbf15bd26252baf6c8f82f3882508a6be43399))
* **cli:** keep watch alive without cwd ([#956](https://github.com/sebastian-software/palamedes/issues/956)) ([17c9cc0](https://github.com/sebastian-software/palamedes/commit/17c9cc0080e731cf22e785b8e16e330ae1e4e51d))
* **cli:** reject mismatched native package versions ([#936](https://github.com/sebastian-software/palamedes/issues/936)) ([38f71ef](https://github.com/sebastian-software/palamedes/commit/38f71efd11e362c9313fdab9cacfbe0c6b4959bf))
* **cli:** report extraction cache write failures ([#962](https://github.com/sebastian-software/palamedes/issues/962)) ([344f592](https://github.com/sebastian-software/palamedes/commit/344f5928f554ff39be1fa28735f738d46861f8b0))
* **config:** reject unknown configuration keys ([#930](https://github.com/sebastian-software/palamedes/issues/930)) ([e99416a](https://github.com/sebastian-software/palamedes/commit/e99416ac7742632faae833a6370c42b7b4d8d0ff))
* **core:** avoid eager transform source locations ([#944](https://github.com/sebastian-software/palamedes/issues/944)) ([711e840](https://github.com/sebastian-software/palamedes/commit/711e8400e6f02a6c38f19e7e3f33cff419b81ddc))
* **core:** escape carriage returns in generated strings ([#935](https://github.com/sebastian-software/palamedes/issues/935)) ([6e24042](https://github.com/sebastian-software/palamedes/commit/6e240427a42f7ade69d4611d9f5a34f513f99e7b))
* **core:** locate parser diagnostics ([#926](https://github.com/sebastian-software/palamedes/issues/926)) ([6c3f55e](https://github.com/sebastian-software/palamedes/commit/6c3f55eb63fd4b39bad59828ebcd33bab97e1f6a))
* **core:** preserve dotted catalog paths ([#959](https://github.com/sebastian-software/palamedes/issues/959)) ([6fd0ae8](https://github.com/sebastian-software/palamedes/commit/6fd0ae88b5e97dcb1040e973a259de8dd14836f6))
* **examples:** render Waku document locale on server ([#1025](https://github.com/sebastian-software/palamedes/issues/1025)) ([e159226](https://github.com/sebastian-software/palamedes/commit/e159226bf238ccd45471697899a2af9dc0f02888))
* **macros:** publish typed authoring signatures ([#933](https://github.com/sebastian-software/palamedes/issues/933)) ([9210df8](https://github.com/sebastian-software/palamedes/commit/9210df8f5a563aa980b63d8a1eb0b4bb81499ae3))
* **next-plugin:** resolve Palamedes from the Next project root ([#931](https://github.com/sebastian-software/palamedes/issues/931)) ([c6e439a](https://github.com/sebastian-software/palamedes/commit/c6e439a4ff1f2a7382f6519f13025cce6470dc92))
* **packaging:** route CJS consumers to .d.cts declarations ([#927](https://github.com/sebastian-software/palamedes/issues/927)) ([4be245d](https://github.com/sebastian-software/palamedes/commit/4be245d5d7151702ca46fca6dff95df4fa9a084c))
* **plugins:** align bundler transform filters ([#961](https://github.com/sebastian-software/palamedes/issues/961)) ([b1a1bd6](https://github.com/sebastian-software/palamedes/commit/b1a1bd63c8bd9f9c0df7990510bda89469b73158))
* **react-router-rsc:** allow supported peer patches ([#923](https://github.com/sebastian-software/palamedes/issues/923)) ([9335e86](https://github.com/sebastian-software/palamedes/commit/9335e86294352903c5d0bd1887cf126aa2326a96))
* **react:** render compat ICU fallbacks with compiled runtime ([#924](https://github.com/sebastian-software/palamedes/issues/924)) ([a52f325](https://github.com/sebastian-software/palamedes/commit/a52f325864922203eb6e9b2a9052b13204fed145))
* **release:** publish JavaScript packages in dependency order ([#925](https://github.com/sebastian-software/palamedes/issues/925)) ([80da682](https://github.com/sebastian-software/palamedes/commit/80da682a053f01f4e748bf0d47772f36e8dc337a))
* **remix:** invalidate config cache ([#960](https://github.com/sebastian-software/palamedes/issues/960)) ([2299c97](https://github.com/sebastian-software/palamedes/commit/2299c97fa3aced82a386f98a31a7bd4b3a21839c))
* **runtime:** recognize browser workers ([#957](https://github.com/sebastian-software/palamedes/issues/957)) ([00e28f4](https://github.com/sebastian-software/palamedes/commit/00e28f4a0458cf51dbc2390856628dc267f10c2c))
* **runtime:** support deterministic ICU time zones ([#937](https://github.com/sebastian-software/palamedes/issues/937)) ([e9caac1](https://github.com/sebastian-software/palamedes/commit/e9caac13e1b4ae718b7fa318689de1979e4372b8))
* **site:** restructure the guided quickstart ([#949](https://github.com/sebastian-software/palamedes/issues/949)) ([84f664c](https://github.com/sebastian-software/palamedes/commit/84f664ce9ec5e7a879c4bef41b7afc52d8ce53cf))
* **solid:** render fallbacks and reactive props ([#1034](https://github.com/sebastian-software/palamedes/issues/1034)) ([f3aff25](https://github.com/sebastian-software/palamedes/commit/f3aff25603faf9516510a176c343f0b3fa9e5fcb))
* **vite-plugin:** gate React MDX on Vite 8 ([#939](https://github.com/sebastian-software/palamedes/issues/939)) ([79f3ac2](https://github.com/sebastian-software/palamedes/commit/79f3ac227d11c4a7a3fc6224c590d010c7c50a56))
* **vite-plugin:** invalidate graph config ([#955](https://github.com/sebastian-software/palamedes/issues/955)) ([5b2e362](https://github.com/sebastian-software/palamedes/commit/5b2e36238073f72141da03fe9d9fd1d0f9cd72e1))
* **vite-plugin:** stabilize graph sidecar keys ([#932](https://github.com/sebastian-software/palamedes/issues/932)) ([14e3ac5](https://github.com/sebastian-software/palamedes/commit/14e3ac5ed6d020c4ea88c20e3985b50b9e9eb1f9))
* **vite-plugin:** use resolved base for import maps ([#929](https://github.com/sebastian-software/palamedes/issues/929)) ([a234e27](https://github.com/sebastian-software/palamedes/commit/a234e27a084b74eb525361d76f680382f593546d))
* **waku:** decouple request fallback errors ([#958](https://github.com/sebastian-software/palamedes/issues/958)) ([c2149db](https://github.com/sebastian-software/palamedes/commit/c2149db2c5abbab258b6e88c2c3a068af014c85d))


### Performance Improvements

* **cli:** cache binary plugin manifests ([#965](https://github.com/sebastian-software/palamedes/issues/965)) ([c2d6261](https://github.com/sebastian-software/palamedes/commit/c2d626106a891fb3d145c2cc64c876dea20f2186))
* **cli:** discover sources with ferralk ([#878](https://github.com/sebastian-software/palamedes/issues/878)) ([e3eb76f](https://github.com/sebastian-software/palamedes/commit/e3eb76f8903df72587b79794a0a741967f320476))
* **core-node:** avoid duplicate bulk argument copies ([#964](https://github.com/sebastian-software/palamedes/issues/964)) ([1254152](https://github.com/sebastian-software/palamedes/commit/12541522332056868bf2393fff1b40bfa6333eb0))
* **core:** cache marker-free extraction results ([#963](https://github.com/sebastian-software/palamedes/issues/963)) ([dfb4427](https://github.com/sebastian-software/palamedes/commit/dfb4427cfc5db4b330b422d1c0749d8035d7d39e))
* **core:** index translation candidate PO items ([#947](https://github.com/sebastian-software/palamedes/issues/947)) ([698f5d1](https://github.com/sebastian-software/palamedes/commit/698f5d11d1bfcdae187779a261314c26afcc93d3))
* **eslint-plugin:** batch diagnostic offset conversion ([#967](https://github.com/sebastian-software/palamedes/issues/967)) ([ab697c6](https://github.com/sebastian-software/palamedes/commit/ab697c69184f17890f73e2f8aaace874db8d2ce1))
* **mdx:** linearize source map position tracking ([#946](https://github.com/sebastian-software/palamedes/issues/946)) ([0f11da0](https://github.com/sebastian-software/palamedes/commit/0f11da0ebe15eb962e0b34d153718b5b2c4564db))
* **react:** reuse message runtimes ([#966](https://github.com/sebastian-software/palamedes/issues/966)) ([10c9cc1](https://github.com/sebastian-software/palamedes/commit/10c9cc14ebf2173bd2e46570705c10ec5e32560b))

## [1.17.3](https://github.com/sebastian-software/palamedes/compare/palamedes-v1.17.2...palamedes-v1.17.3) (2026-08-12)


### Bug Fixes

* pin the two guard wirings and correct the docs residuals ([#836](https://github.com/sebastian-software/palamedes/issues/836)) ([10b75ba](https://github.com/sebastian-software/palamedes/commit/10b75ba3ec48fa0a0dd42a99d1d9feff17d7a7a3))

## [1.17.2](https://github.com/sebastian-software/palamedes/compare/palamedes-v1.17.1...palamedes-v1.17.2) (2026-08-11)


### Bug Fixes

* **ci:** restore example coverage ([#826](https://github.com/sebastian-software/palamedes/issues/826)) ([2e00d98](https://github.com/sebastian-software/palamedes/commit/2e00d9877a7ba6c7151c8fbdb8e9d3f9d0a56868))
* finish core and example residuals ([#830](https://github.com/sebastian-software/palamedes/issues/830)) ([f88dd03](https://github.com/sebastian-software/palamedes/commit/f88dd0349f8bea541d7f037bf207c5a371d81c4f))

## [1.17.1](https://github.com/sebastian-software/palamedes/compare/palamedes-v1.17.0...palamedes-v1.17.1) (2026-08-11)


### Bug Fixes

* **config:** declare picomatch matcher API ([3cc9b53](https://github.com/sebastian-software/palamedes/commit/3cc9b536d897ecf75c8780e084c7e6854d1e52d5))
* **examples:** align remix locale strategies ([#811](https://github.com/sebastian-software/palamedes/issues/811)) ([df684d4](https://github.com/sebastian-software/palamedes/commit/df684d4c44fcd3d2993a592de8f1a4cb154e273c))
* **extract:** unique Trans JSX placeholders ([#776](https://github.com/sebastian-software/palamedes/issues/776)) ([46e0c55](https://github.com/sebastian-software/palamedes/commit/46e0c55a291d6660f05d86c28829f7e42f6e839f))
* **release:** guard native publish artifacts ([#773](https://github.com/sebastian-software/palamedes/issues/773)) ([d2b02c4](https://github.com/sebastian-software/palamedes/commit/d2b02c4f95c54fc195a907ea39441caa32968017))
* **scripts:** resolve shared workspace paths ([44bbb8e](https://github.com/sebastian-software/palamedes/commit/44bbb8ec115b7d96b2bae978f312bd686283498c))
* **scripts:** select screenshot examples for capture ([cec2677](https://github.com/sebastian-software/palamedes/commit/cec2677d6184fba5fe6ff1186d915de7f4c4005b))
* **scripts:** select screenshot examples for capture ([782d98b](https://github.com/sebastian-software/palamedes/commit/782d98b5e925895c9cbb03022b580c768c866032))

## [1.17.0](https://github.com/sebastian-software/palamedes/compare/palamedes-v1.16.1...palamedes-v1.17.0) (2026-08-11)


### Features

* **packaging:** publish linux-arm64-musl native packages ([#727](https://github.com/sebastian-software/palamedes/issues/727)) ([988475a](https://github.com/sebastian-software/palamedes/commit/988475a928592320837db916b39531177ee1ef8b))


### Bug Fixes

* **ci:** stop partial releases and make the audit alerts reachable ([#718](https://github.com/sebastian-software/palamedes/issues/718)) ([259f026](https://github.com/sebastian-software/palamedes/commit/259f026daaa4e3036f36a73486adad2226806734))
* **cli:** merge with a JS/TS config, guard FCL in watch, and fix command errors ([#722](https://github.com/sebastian-software/palamedes/issues/722)) ([ebb6986](https://github.com/sebastian-software/palamedes/commit/ebb6986aca5c9f355b61ace797f7ef5a43218e66)), closes [#696](https://github.com/sebastian-software/palamedes/issues/696) [#697](https://github.com/sebastian-software/palamedes/issues/697) [#698](https://github.com/sebastian-software/palamedes/issues/698) [#699](https://github.com/sebastian-software/palamedes/issues/699) [#700](https://github.com/sebastian-software/palamedes/issues/700)
* close four verification and documentation gaps from the audit ([#725](https://github.com/sebastian-software/palamedes/issues/725)) ([fba8372](https://github.com/sebastian-software/palamedes/commit/fba837215eb0ee500e9217401856456b6dd9f6d5))
* **core-node:** keep confidence stable and severity typed across the boundary ([#721](https://github.com/sebastian-software/palamedes/issues/721)) ([ca9a599](https://github.com/sebastian-software/palamedes/commit/ca9a599c75118c29faee4f0899b6e1cc5ea3edf9))
* **core:** four audit findings in macro resolution, catalog updates, and translation patches ([#726](https://github.com/sebastian-software/palamedes/issues/726)) ([d2b5979](https://github.com/sebastian-software/palamedes/commit/d2b5979127af37ff7dfb9ba1686cc742b0287ab2))
* **examples:** close the client/server locale gaps in the example matrix ([#723](https://github.com/sebastian-software/palamedes/issues/723)) ([0f22753](https://github.com/sebastian-software/palamedes/commit/0f227536dd50b36508635ff4a3bebd6de3a577cb))
* five audit findings in the graph-splitting and runtime registration surface ([#720](https://github.com/sebastian-software/palamedes/issues/720)) ([9ec126c](https://github.com/sebastian-software/palamedes/commit/9ec126cc2e7481a3327e5ec994bd6cece1d8f107))
* **site:** stop tracking the generated route registry ([#728](https://github.com/sebastian-software/palamedes/issues/728)) ([9afa998](https://github.com/sebastian-software/palamedes/commit/9afa998d9c955655df3f57bcfa3320ff98d409a8))

## [1.16.1](https://github.com/sebastian-software/palamedes/compare/palamedes-v1.16.0...palamedes-v1.16.1) (2026-08-10)


### Bug Fixes

* add coverage and harden lint and release builds ([#679](https://github.com/sebastian-software/palamedes/issues/679)) ([72b1a49](https://github.com/sebastian-software/palamedes/commit/72b1a49b9d9f122a2c3d2dfd0e8f22003d02361d))

## [1.16.0](https://github.com/sebastian-software/palamedes/compare/palamedes-v1.15.0...palamedes-v1.16.0) (2026-08-10)


### Features

* **remix:** cover locale-scoped UI frames ([fdb1b4d](https://github.com/sebastian-software/palamedes/commit/fdb1b4ddd3e530eab2ab95d55cd096667f4c0439))


### Bug Fixes

* **cli:** synchronize lint suppression scanner ([de7f626](https://github.com/sebastian-software/palamedes/commit/de7f626ddd23036fe5ed844ee862e6b17a59e62d))
* **cli:** synchronize lint suppression scanner ([39a9647](https://github.com/sebastian-software/palamedes/commit/39a964705d07be5c509662e9a3bfc118e72f1793))
* **core-node:** prepare test support addon before tests ([ee43ed4](https://github.com/sebastian-software/palamedes/commit/ee43ed44b56d0119b5d0c824063b199cdd330267))
* **core-node:** preserve prototype getter snapshots ([11c92b7](https://github.com/sebastian-software/palamedes/commit/11c92b7e5a5bc030ff72bd6ac805cecee4118b6e))
* **core-node:** restore class-instance snapshot semantics and reject Maps ([6b14fec](https://github.com/sebastian-software/palamedes/commit/6b14fec9795ea6c3640d51161649a26c36e3c44f)), closes [#663](https://github.com/sebastian-software/palamedes/issues/663) [#664](https://github.com/sebastian-software/palamedes/issues/664)
* **core:** limit target candidates to addressed locales ([949be14](https://github.com/sebastian-software/palamedes/commit/949be1425a32787bf070da5043964fb2dfb41cfc))
* **core:** scope explicit target candidates to addressed locales ([f569041](https://github.com/sebastian-software/palamedes/commit/f5690414b1a987bc042372b101c49996ec4aed15))
* **core:** validate singular translation ICU ([632f9c1](https://github.com/sebastian-software/palamedes/commit/632f9c1b89ab070fe99fa53a34c8974ffbbaca8f))
* **examples:** keep the react-router-rsc root layout client-safe ([7102e6a](https://github.com/sebastian-software/palamedes/commit/7102e6a123a0995f5780bc056a3ce8b110bdc5f7))
* **examples:** serve the negotiated locale as react-router-rsc document lang ([c6ccd14](https://github.com/sebastian-software/palamedes/commit/c6ccd14492a3dcfd7eeabbc712c8621acf4a381e)), closes [#665](https://github.com/sebastian-software/palamedes/issues/665)
* **examples:** synchronize Waku document locale ([db3ca74](https://github.com/sebastian-software/palamedes/commit/db3ca74c1ddeb37b014444ee4d1d2e9f2484336b))
* **next:** degrade invalid catalog fragments ([6c51e36](https://github.com/sebastian-software/palamedes/commit/6c51e369b389cc6aa0633c2d25c61ebd95c3a8dc))
* **next:** harden split catalog caches ([4b9d5c9](https://github.com/sebastian-software/palamedes/commit/4b9d5c9e8e82dccf47edc163790e0264453acf12))
* **next:** register catalog fragments in loader-group order while degrading ([8738fcb](https://github.com/sebastian-software/palamedes/commit/8738fcb2d83568d4fd3d44898912dca4a5d9a92f)), closes [#671](https://github.com/sebastian-software/palamedes/issues/671)
* **next:** reuse installed client locale ([6520c08](https://github.com/sebastian-software/palamedes/commit/6520c08b444911dc6aab14f38c4f43db69f33153))
* **react-router-rsc:** ship ESM-only package ([33a759b](https://github.com/sebastian-software/palamedes/commit/33a759bdcc3321d51629c252664da17520df8544))
* resolve the 2026-08-09 audit findings ([1a74390](https://github.com/sebastian-software/palamedes/commit/1a74390a0a61bc5cf8bf5943e63085aadc021dcd))
* **tanstack:** brand resolver failures ([069d9ab](https://github.com/sebastian-software/palamedes/commit/069d9abac00bd4c9654eb764db77d9c10b1c1860))
* **transform:** instrument server action const aliases ([0dc6f63](https://github.com/sebastian-software/palamedes/commit/0dc6f63fdaf9596d97178e53d7bb1a9d3e496f97))
* **waku:** resolve packed runtime locally ([1c8e4b9](https://github.com/sebastian-software/palamedes/commit/1c8e4b9e6363808b3e74f478f489723e41dbf9d4))
* **waku:** resolve packed runtime locally ([f9c20bc](https://github.com/sebastian-software/palamedes/commit/f9c20bca995e7a14bfb5ca5e898737d2f7019f92))

## [1.15.0](https://github.com/sebastian-software/palamedes/compare/palamedes-v1.14.0...palamedes-v1.15.0) (2026-08-08)


### Features

* add React Router RSC i18n scope ([#565](https://github.com/sebastian-software/palamedes/issues/565)) ([a81f347](https://github.com/sebastian-software/palamedes/commit/a81f3479f9fc8d146416798b92d674291ca3baf5))
* add TanStack Start server i18n middleware ([50fd349](https://github.com/sebastian-software/palamedes/commit/50fd34901d0fdf76ab1ba97bb331de4a8842f386))
* **waku:** add request-scoped server action i18n ([75bdd69](https://github.com/sebastian-software/palamedes/commit/75bdd694cef8477cf662476cb4e23767269bc81c))


### Bug Fixes

* **ci:** align example verification proof and scheduling ([2f367b6](https://github.com/sebastian-software/palamedes/commit/2f367b65f81e05ff7b7169071a72719680ecb696))
* **ci:** distinguish example proof coverage ([7f32ec7](https://github.com/sebastian-software/palamedes/commit/7f32ec7369f38262b7f3485a74f8a62b98f52ef4))
* **ci:** harden matrix and container contracts ([a9a96d3](https://github.com/sebastian-software/palamedes/commit/a9a96d309cd54e4899ca8293de42286f693574ab))
* **ci:** simplify catalog cache test hook ([977ff9b](https://github.com/sebastian-software/palamedes/commit/977ff9b8a8a5c314e4cee498c78ae15566ae80e8))
* **cli+core:** align audit verdict and locales ([841c5cb](https://github.com/sebastian-software/palamedes/commit/841c5cbb03be597c346eed8811323bb435df08dd))
* **cli:** complete lint suppression scanner ([f55ebfa](https://github.com/sebastian-software/palamedes/commit/f55ebfa6fce45d5944bd0472ff5e6661802da7e8))
* **cli:** handle Windows tar entry endings ([c2d40cc](https://github.com/sebastian-software/palamedes/commit/c2d40ccf66ef8c5705493f42a6f96ae5e39a077d))
* **cli:** harden lint analysis ([35428f5](https://github.com/sebastian-software/palamedes/commit/35428f5c3471017e2a9421e4a6af2bbc6f7c9515))
* **cli:** reserve all clap plugin namespaces ([6db57e0](https://github.com/sebastian-software/palamedes/commit/6db57e0cd0ae28c9d30bad963a1c8556b4d3d4ac))
* **cli:** reserve lint plugin namespace ([d330c3a](https://github.com/sebastian-software/palamedes/commit/d330c3a6ce934a3b7355252aca6d10180d8d1c91))
* **cli:** resolve catalog merge driver paths ([4a35a5f](https://github.com/sebastian-software/palamedes/commit/4a35a5f48e740fde5774fef5483e72971397a07c))
* **cli:** restrict npm tarball runtime files ([b410e3b](https://github.com/sebastian-software/palamedes/commit/b410e3bb2bd55eb679c61077dc4e7a6e9f315e4d))
* **cli:** scan nested lint suppression comments ([16c96fe](https://github.com/sebastian-software/palamedes/commit/16c96fe58dd2e46ebbb349188849402a8edc865b))
* **core-node:** catch panics at N-API boundary ([46628c0](https://github.com/sebastian-software/palamedes/commit/46628c08960beb4f31e22cb6e3f14387e748fc59))
* **core-node:** harden native boundary contracts ([fb8f418](https://github.com/sebastian-software/palamedes/commit/fb8f4189b73e12a6e02ad47407ecadd4aba64c55))
* **core-node:** preserve snapshot input semantics ([6e859a4](https://github.com/sebastian-software/palamedes/commit/6e859a4eb59af771abc918ae9b8d156d01c4bac7))
* **core-node:** snapshot native boundary inputs ([1ec9632](https://github.com/sebastian-software/palamedes/commit/1ec9632dc4bcd2c5ce4fac2abca3fcc1cdda318b))
* **core:** canonicalize translation candidate origins ([57cad3a](https://github.com/sebastian-software/palamedes/commit/57cad3aea8be2cdfc34de424e9345976485fbc31))
* **core:** fingerprint complete translation origins ([cfca9d8](https://github.com/sebastian-software/palamedes/commit/cfca9d8fd65b901138e099e1576433b8a4a2ff01))
* **core:** harden macro import cleanup ([b2bec80](https://github.com/sebastian-software/palamedes/commit/b2bec80ab50b12f24415f240820f46efee06e122))
* **core:** keep translation workflows target-only ([c2661da](https://github.com/sebastian-software/palamedes/commit/c2661da372fc81b9cca185b92bd4116cf9a4b35b))
* **core:** preserve explicit translation failures ([d798095](https://github.com/sebastian-software/palamedes/commit/d798095d07a747b8b10d5892a291622cb44ed752))
* **core:** preserve live macro imports ([a616ec4](https://github.com/sebastian-software/palamedes/commit/a616ec434f63da6fde7acae978ec95dbe6d44cd4))
* **core:** reject invalid plural ICU patches ([37d6762](https://github.com/sebastian-software/palamedes/commit/37d6762e0331bc85e854659f978d44cd59629310))
* **core:** scope Trans import reuse ([e154da2](https://github.com/sebastian-software/palamedes/commit/e154da2e4b50b079bd157461c079f85eb7956eb9))
* **eslint-plugin:** report native failures once ([19f3c14](https://github.com/sebastian-software/palamedes/commit/19f3c14202bcdc0979c714e0448f2ed8414a706f))
* **eslint-plugin:** track native failure claims with WeakMap ([ba5ff66](https://github.com/sebastian-software/palamedes/commit/ba5ff660ff115bfe0e943f53c1d95e403e42eac4))
* **examples:** preserve server locale during hydration ([125ee22](https://github.com/sebastian-software/palamedes/commit/125ee2210b57fbe1dfe0dd4e282a4b8940902c90))
* **examples:** scope server i18n per request ([03e1121](https://github.com/sebastian-software/palamedes/commit/03e1121a5128667fe2e071703883b29c7e3afe54))
* **examples:** strengthen cookie hydration regression ([256f936](https://github.com/sebastian-software/palamedes/commit/256f936efa4ea69f2b6086b134880bf005fd3df3))
* harden React Router RSC request proof ([bea1e70](https://github.com/sebastian-software/palamedes/commit/bea1e70bc0b10874287ed81b0ad95cd6888d0abe))
* keep published type fixtures separate ([cd2ffec](https://github.com/sebastian-software/palamedes/commit/cd2ffecde2b87ddda214f554b4e0b1558d962132))
* make TanStack middleware ESM-only ([7fb7391](https://github.com/sebastian-software/palamedes/commit/7fb7391b243f9b8c52eaeff9582e01ff86e3b0b6))
* **next-example:** allow localhost dev origin for catalog test ([6e86e9d](https://github.com/sebastian-software/palamedes/commit/6e86e9d404ad7a54ed156e535b14e5e535daeda8))
* **next-example:** reload after cookie locale switch ([0ecf6ed](https://github.com/sebastian-software/palamedes/commit/0ecf6ed43fde4102d305f397c00137c78e2e0d3b))
* **next:** avoid empty split cleanup warnings ([aa22831](https://github.com/sebastian-software/palamedes/commit/aa228312b24c5e4486437716082e5e2290b66556))
* **next:** degrade failed client catalog fragments ([0cb9215](https://github.com/sebastian-software/palamedes/commit/0cb9215a9b3a0658dddd285f4a90525c72846718))
* **next:** harden catalog cache lifecycle ([d71ac89](https://github.com/sebastian-software/palamedes/commit/d71ac89bccc5dc90c04f771fd66974def884265d))
* **next:** harden fragment failure diagnostics ([83b719e](https://github.com/sebastian-software/palamedes/commit/83b719eb910030ec53a2c160c32c308ca3311710))
* **next:** harden split-catalog dev invalidation ([e5c383e](https://github.com/sebastian-software/palamedes/commit/e5c383e80519c804e86b8201290831f6a6fc19d8))
* **next:** initialize client fragments before module body ([fec7a3b](https://github.com/sebastian-software/palamedes/commit/fec7a3bc8ad38bcda10a6d6ab34714ded4dda017))
* **next:** rebase indexed client source maps ([fa1d565](https://github.com/sebastian-software/palamedes/commit/fa1d56596263e14cde61ab645d536cf1b1cb291a))
* **node:** retain partial patch reports on write failures ([5e65dfa](https://github.com/sebastian-software/palamedes/commit/5e65dfa05c178bca434b2b8584fe4f0bfe511719))
* **react:** evict catalog after boundary errors ([4b938d6](https://github.com/sebastian-software/palamedes/commit/4b938d6bcfa0954a7be43d6e57ea291c0e8c99ae))
* **react:** evict rejected catalog resources ([d8a3326](https://github.com/sebastian-software/palamedes/commit/d8a332626292a1d3df1beba178f599c8182b574c))
* **react:** surface rejected catalog loads ([7a2ac6a](https://github.com/sebastian-software/palamedes/commit/7a2ac6ac6913edb4da037ac8f7854f00384f0153))
* run TanStack package tests on Windows ([f464066](https://github.com/sebastian-software/palamedes/commit/f464066d9dec879aeeb1201222b25e5d1f2de117))
* satisfy llms guard lint ([2f3a44c](https://github.com/sebastian-software/palamedes/commit/2f3a44c98af5b1085895a43ca9f780da52307c95))
* **transform:** instrument local server action handlers ([704f490](https://github.com/sebastian-software/palamedes/commit/704f4902d2506529530c1b0aff44f4d35656ca8b))
* **transform:** resolve local handlers by binding ([7d33098](https://github.com/sebastian-software/palamedes/commit/7d330984897d5ac8b94fd2275b6c53ae005fcc07))
* **waku:** ship an ESM-only adapter ([5565820](https://github.com/sebastian-software/palamedes/commit/55658209ad8c1404dfa374f46a3dac72929add54))


### Performance Improvements

* **next:** cache selected catalog snapshots ([a763478](https://github.com/sebastian-software/palamedes/commit/a763478ad0da21ac57f2b179eddbaf1948f81bac))

## [1.14.0](https://github.com/sebastian-software/palamedes/compare/palamedes-v1.13.0...palamedes-v1.14.0) (2026-08-06)


### Features

* **cli:** add non-mutating extraction checks ([dfd8c0c](https://github.com/sebastian-software/palamedes/commit/dfd8c0c78a4eca4eb2d37ac26e8130d3a27d22eb))


### Bug Fixes

* **deps:** update rust crate signal-hook to 0.4.0 ([2a3b32a](https://github.com/sebastian-software/palamedes/commit/2a3b32ac7088c4a8fd37db17b49fc5d2ab500340))
* format minimum release age exclusions ([fb510a3](https://github.com/sebastian-software/palamedes/commit/fb510a3f6d80a867e72b46df2802845d95c6fc25))
* **site:** build TypeDoc packages before conversion ([1bf4708](https://github.com/sebastian-software/palamedes/commit/1bf47085e5b2c0c6d686d7a28fb3615e0b38257e))

## [1.13.0](https://github.com/sebastian-software/palamedes/compare/palamedes-v1.12.0...palamedes-v1.13.0) (2026-08-06)


### Features

* **benchmark:** add a General Translation lane to the e2e workflow benchmark ([11f2861](https://github.com/sebastian-software/palamedes/commit/11f28614d7116cbd523a4a29cf37a680d683fb61))
* **cli:** allow audit info threshold ([c85e7a2](https://github.com/sebastian-software/palamedes/commit/c85e7a299ca9560b54780318cbbb0e75eb41e485))
* **core-node:** expose translation patch workflow ([f006684](https://github.com/sebastian-software/palamedes/commit/f00668465af2fddb8d56b9a1e02d5a6bd9a80962))
* **core:** add translation candidate patch APIs ([c425124](https://github.com/sebastian-software/palamedes/commit/c425124545403b2b867bd9fad5a4a9799b3545dc))
* **next:** initialize i18n in server functions ([#543](https://github.com/sebastian-software/palamedes/issues/543)) ([6e21b1f](https://github.com/sebastian-software/palamedes/commit/6e21b1f9fc511fe57a5e6d9691736b96b3190193))
* **next:** split client messages by module graph ([3d6476a](https://github.com/sebastian-software/palamedes/commit/3d6476abbb036f8c5c73fb6e8a9abf0562fddfe0))
* **next:** split client messages by module graph ([796d022](https://github.com/sebastian-software/palamedes/commit/796d022a1cc578512e28cd1dd0bd363760a009b8))
* **next:** split Server Function catalogs by module ([#545](https://github.com/sebastian-software/palamedes/issues/545)) ([56ca14d](https://github.com/sebastian-software/palamedes/commit/56ca14d2410b99c65fd33a03956871cebe974ba0))


### Bug Fixes

* **audit:** detect repeated argument loss ([c400cd4](https://github.com/sebastian-software/palamedes/commit/c400cd410b1b9597e25935440849d8609ca9932b))
* **cli:** add deletion-aware three-way catalog merge ([e51b0c5](https://github.com/sebastian-software/palamedes/commit/e51b0c5c59edff01a0318e514cea26a48dedca20))
* **next:** preserve i18n scope across RSC suspension ([#539](https://github.com/sebastian-software/palamedes/issues/539)) ([1f6b749](https://github.com/sebastian-software/palamedes/commit/1f6b74931b3f19eaf1ca6e8555d146b3bc62df5d))
* **site:** resolve compiled core entry in TypeDoc ([#536](https://github.com/sebastian-software/palamedes/issues/536)) ([92a651f](https://github.com/sebastian-software/palamedes/commit/92a651f0ab9c1ee451e0e2f86dff9f16bcdd713e))

## [1.12.0](https://github.com/sebastian-software/palamedes/compare/palamedes-v1.11.0...palamedes-v1.12.0) (2026-08-04)


### Features

* **cli:** add native source lint command ([b1fa7f5](https://github.com/sebastian-software/palamedes/commit/b1fa7f5ddbb834c381eee01ffbf9ca85c35ac8d5))
* **core:** add shared source analysis ([d497b38](https://github.com/sebastian-software/palamedes/commit/d497b388fcad6c7a52baf518b2237c90fcbff157))
* **core:** diagnose messages without translatable content ([02e1155](https://github.com/sebastian-software/palamedes/commit/02e1155bf8fb643b239934b97c848bd4a2bce7f6))
* **core:** share source analysis cache ([b5c1d64](https://github.com/sebastian-software/palamedes/commit/b5c1d64eb3a07fb73c57167f9524c7eae7af4ee1))
* **core:** suggest Trans in JSX render positions ([a795c57](https://github.com/sebastian-software/palamedes/commit/a795c575f683b86aaccb1efbb5f3b6ed61244875))
* **lint:** add ESLint and Oxlint adapter ([229db2d](https://github.com/sebastian-software/palamedes/commit/229db2d9f332df8d48eb87d973d5faddf430664f))


### Bug Fixes

* **deps:** patch shared tooling vulnerabilities ([#529](https://github.com/sebastian-software/palamedes/issues/529)) ([18134c5](https://github.com/sebastian-software/palamedes/commit/18134c5cd9f929cb65c63498aebf9e12faa4ebf9))
* **deps:** patch Solid transitive vulnerabilities ([#528](https://github.com/sebastian-software/palamedes/issues/528)) ([41a72dc](https://github.com/sebastian-software/palamedes/commit/41a72dc6a8745a589155f7da12fb1743fe8d03ce))
* **lint:** address source analysis review feedback ([ece85e2](https://github.com/sebastian-software/palamedes/commit/ece85e2fb253e63842cf012eb89fc868517f923f))
* **lint:** refresh adapter lockfile resolution ([3d56d74](https://github.com/sebastian-software/palamedes/commit/3d56d7491e46499f8ad66da14ee9eb16ad1936df))
* **runtime:** restore hook-free locale access ([2866b7d](https://github.com/sebastian-software/palamedes/commit/2866b7ddfc9ad02206ae9f4aa297e82c878a34a6))
* **solid:** type compiled runtime renderer ([#522](https://github.com/sebastian-software/palamedes/issues/522)) ([9b4d47a](https://github.com/sebastian-software/palamedes/commit/9b4d47a8ea05066b33038c7a193a63440181bb8e))

## [1.11.0](https://github.com/sebastian-software/palamedes/compare/palamedes-v1.10.0...palamedes-v1.11.0) (2026-08-03)


### Features

* **cli:** host binary plugins in Rust ([#512](https://github.com/sebastian-software/palamedes/issues/512)) ([138ff22](https://github.com/sebastian-software/palamedes/commit/138ff22001f795a92cb0ca3cfb1c7182e99b5552))
* **examples:** bind react-router-cookie locales through import maps ([c297b6d](https://github.com/sebastian-software/palamedes/commit/c297b6d47c0f4ccdcb9786f3bdfd65af3526aeeb))
* **examples:** preload mapped message assets from the stream injector ([58077e1](https://github.com/sebastian-software/palamedes/commit/58077e15ce2842bc4c36abc63bb46e61e3991d71))
* **examples:** run the MDX example on graph splitting ([1162a4f](https://github.com/sebastian-software/palamedes/commit/1162a4f773aa61838a9a6cacae83a2d7c1bccf81))
* **examples:** split react-router-cookie messages along the route graph ([34eea1a](https://github.com/sebastian-software/palamedes/commit/34eea1a83ca13b2ef49c6105a8316e1dceb756dd))
* **next:** add render-safe client catalog bootstrap ([#509](https://github.com/sebastian-software/palamedes/issues/509)) ([e6904f1](https://github.com/sebastian-software/palamedes/commit/e6904f16907cbf9cc77bdf240774ca9407233390))
* **runtime:** buffer generated message registrations ([ce858d6](https://github.com/sebastian-software/palamedes/commit/ce858d6b33edbc6d930f45b14cd3fe023f48a640))
* **vite-plugin:** experimental graph splitting for messages ([c886e55](https://github.com/sebastian-software/palamedes/commit/c886e55c2d9579bb77f8f030c425578305c977b2))
* **vite-plugin:** import-map locale binding for graph splitting ([8d06fc5](https://github.com/sebastian-software/palamedes/commit/8d06fc59284bb39758c9129348bb87c866f8e06e))
* **vite-plugin:** record chunk message imports in the split manifest ([26d60d3](https://github.com/sebastian-software/palamedes/commit/26d60d3bc2b003d34f835b4bad4fb612db037a4f))
* **vite-plugin:** split MDX messages and stop skipping the pseudo locale ([23be99e](https://github.com/sebastian-software/palamedes/commit/23be99ebf408da35760f4cfad5a76142966b384b))


### Bug Fixes

* **runtime:** resolve server-side getI18n without a React hook ([89b4263](https://github.com/sebastian-software/palamedes/commit/89b4263ee7143080f9c4c08da458d19b105ff0fa))
* **transform:** avoid runtime import collisions ([#498](https://github.com/sebastian-software/palamedes/issues/498)) ([9192916](https://github.com/sebastian-software/palamedes/commit/9192916c529e87eb1fc6a98cf9a9213e4a3ac5db))


### Performance Improvements

* **runtime:** keep generated browser bundles parser-free ([84c2fa3](https://github.com/sebastian-software/palamedes/commit/84c2fa3d002e39e7c4159486090846f52ed18700))
* **runtime:** precompile generated catalog messages ([6f5c55f](https://github.com/sebastian-software/palamedes/commit/6f5c55f6ec86337fec3115269dbe1d91d2ec679b))

## [1.10.0](https://github.com/sebastian-software/palamedes/compare/palamedes-v1.9.0...palamedes-v1.10.0) (2026-07-31)


### Features

* **catalog:** adopt Ferrocat 3.2.2 ([04625e5](https://github.com/sebastian-software/palamedes/commit/04625e5d696692a10d9adf004697d335132f3ffe))
* **catalog:** adopt Ferrocat 3.3.0 and skip write barriers for catalogs ([6bd81d0](https://github.com/sebastian-software/palamedes/commit/6bd81d030f74544df14531dff10929ffb0fb151c))


### Bug Fixes

* **benchmark:** bound corpus write concurrency to avoid EMFILE ([6a8a0c4](https://github.com/sebastian-software/palamedes/commit/6a8a0c41a5c286c216e4775d661c1aef8a1cd9ce))
* **extract:** preserve apostrophe translations ([6bcedb2](https://github.com/sebastian-software/palamedes/commit/6bcedb238ddd84027d3f163c1c2a3e8e1d3f2d51))


### Performance Improvements

* **cli:** parallelize catalog writes and cut file-set ordering cost ([7b0f4be](https://github.com/sebastian-software/palamedes/commit/7b0f4beb34f3edb57207b72bd42f02d47775056d))
* **extract:** skip parsing files without i18n markers in batch extraction ([6b2579c](https://github.com/sebastian-software/palamedes/commit/6b2579cd018c68c6812e2d5fa06897daf12c6be1))
* **extract:** skip redundant AST walks for files without i18n markers ([e3d6573](https://github.com/sebastian-software/palamedes/commit/e3d65736d0115502b495fecaca77b2c667e71ad5))

## [1.9.0](https://github.com/sebastian-software/palamedes/compare/palamedes-v1.8.0...palamedes-v1.9.0) (2026-07-30)


### Features

* add first-class MDX support ([c6b976e](https://github.com/sebastian-software/palamedes/commit/c6b976e30fa7e4679bb69eecaa76fc677eff214a))
* **catalog:** add configurable PO output options ([9ffec16](https://github.com/sebastian-software/palamedes/commit/9ffec1672891e3e17f7c535eef2f821a2c084813))
* **plugin:** add palamedes-plugin Rust SDK crate ([22c34a6](https://github.com/sebastian-software/palamedes/commit/22c34a671b91e5a6adab93cfb040176a671b50f8))
* **plugins:** select the framework once instead of naming runtime modules ([4e0396c](https://github.com/sebastian-software/palamedes/commit/4e0396c129037f16af6a6aa6cce17acbd3e124a6))


### Bug Fixes

* **catalog:** write merged PO catalogs the way an extraction writes them ([ecfc42f](https://github.com/sebastian-software/palamedes/commit/ecfc42f660064adb6cbe3a60e54e954043fa1e55))
* **ci:** refresh site smoke assertions ([54f4ba6](https://github.com/sebastian-software/palamedes/commit/54f4ba63bc0130dc074cab4a3bab1b7aff7beda3))
* **ci:** stabilize site deployment ([b7beac3](https://github.com/sebastian-software/palamedes/commit/b7beac37a763fa6a2d8f7bf0778c8a38ed28cb7c))
* cleanup ([5d7b5c7](https://github.com/sebastian-software/palamedes/commit/5d7b5c7ffe8c1a836197b9494fddf614628f526c))
* **cli:** resolve the working directory lazily and fallibly ([538cf3f](https://github.com/sebastian-software/palamedes/commit/538cf3f9021730db5db64bedaca5ab0564dd9cef))
* complete MDX integration follow-ups ([1cdf1f7](https://github.com/sebastian-software/palamedes/commit/1cdf1f7b58281ff0bc34829f6b60c72f8c5cf5d2))
* **core-node:** normalize generated native types ([d4985e4](https://github.com/sebastian-software/palamedes/commit/d4985e4c07d82e0af7488e85a87fa73f252afb7f))
* **core,cli:** restore ICU apostrophe parity and harden extraction caching ([1fa8f5b](https://github.com/sebastian-software/palamedes/commit/1fa8f5b76a42ac61167348625fc2214b6a3cc5c0))
* **core,react,solid:** degrade adapter render failures instead of crashing ([466db7a](https://github.com/sebastian-software/palamedes/commit/466db7a5a23a3ef06ba55a6b64978e3a959a5e9e))
* format OSS research dossiers ([15bce24](https://github.com/sebastian-software/palamedes/commit/15bce24c0eb407bd64dce40a45a39c56f6260973))
* harden MDX Vite integration ([b4dcc40](https://github.com/sebastian-software/palamedes/commit/b4dcc4012e0eec231e8c41e24aaf4053d0adca77))
* **next-plugin:** exclude node_modules from the webpack po rule and merge turbopack loader shorthands ([7034bb9](https://github.com/sebastian-software/palamedes/commit/7034bb9b1213fba779e20de126e10ba31d0879b6))
* **plugin:** reject duplicate commands and foreign protocol versions ([afd0ec5](https://github.com/sebastian-software/palamedes/commit/afd0ec5d03ab72bca1567064d7287638b6d29620))
* **transform:** derive lookup keys from canonicalized message text ([f6f5ce1](https://github.com/sebastian-software/palamedes/commit/f6f5ce14807859da9446019a193700356afa9859))
* **vite:** allow configless startup ([34dca70](https://github.com/sebastian-software/palamedes/commit/34dca70a814b474d91792bf163c8b400557be45c))
* **vite:** keep the macro runtime module out of MDX options ([56e2d55](https://github.com/sebastian-software/palamedes/commit/56e2d5537463e0e533fee57c5e88845d1a7e6b00))


### Performance Improvements

* **catalog:** replace ICU collator with a generated root-order table ([8b18c92](https://github.com/sebastian-software/palamedes/commit/8b18c920edcd8ff1a9cbe0c89d093ca94ad9f273))
* **collation:** build sort keys in one pass with an ASCII fast path ([041dcfc](https://github.com/sebastian-software/palamedes/commit/041dcfc06d659c7e93bec6472f14510dc50c7aa0))
* **collation:** decide the catalog order by a packed prefix first ([4cee1c5](https://github.com/sebastian-software/palamedes/commit/4cee1c5dcaf8911c9570e0d722f4168eaa2ac9a7))
* **collation:** index the collation table directly instead of searching it ([9889ed3](https://github.com/sebastian-software/palamedes/commit/9889ed32d8d4f2aff01a90c57360f7e600c6ac19))

## [1.8.0](https://github.com/sebastian-software/palamedes/compare/palamedes-v1.7.0...palamedes-v1.8.0) (2026-07-27)


### Features

* **cli:** add configurable reference scopes ([a6f6519](https://github.com/sebastian-software/palamedes/commit/a6f65192cbde4226789908d794b4366fff779522))
* **cli:** add configurable reference scopes ([45f7522](https://github.com/sebastian-software/palamedes/commit/45f75220cfdf05b87508c52f3bab6b11a9ca3479))


### Bug Fixes

* **benchmarks:** author the lingui-v6 Palamedes lane with the post-1.5.0 macro surface ([079351c](https://github.com/sebastian-software/palamedes/commit/079351c1b2a20e208b610a4f6973827ba8443635))
* **benchmarks:** author the Palamedes lane with the post-1.5.0 macro surface ([3aa1331](https://github.com/sebastian-software/palamedes/commit/3aa1331e129dc94b75b2f91f46bbe3168ee5d819))
* **core:** close two cache correctness gaps found in review ([d646e63](https://github.com/sebastian-software/palamedes/commit/d646e63b192fd41296a11ce85d6579a963f8b249))
* resolve vite plugin declarations ([545094a](https://github.com/sebastian-software/palamedes/commit/545094a77beacc8db639334243c90a102363b8ac))
* resolve vite plugin declarations for TypeScript 6/7 ([c17b131](https://github.com/sebastian-software/palamedes/commit/c17b131bc850f14693987bbd51826995baa6b643))


### Performance Improvements

* **core:** cache extraction results per source file ([7147c30](https://github.com/sebastian-software/palamedes/commit/7147c300b0fbf8eaa49817a34947c8a6fdcf126d))
* **core:** extract source files across a bounded worker pool ([2065bca](https://github.com/sebastian-software/palamedes/commit/2065bca6aecb3059275e93dc5ce41e0faaa422f2))
* **core:** skip the PO metadata round trip when there is nothing to preserve ([00c1b11](https://github.com/sebastian-software/palamedes/commit/00c1b11110550b3a87f9a77b91c8588cbbd8c392))

## [1.7.0](https://github.com/sebastian-software/palamedes/compare/palamedes-v1.6.0...palamedes-v1.7.0) (2026-07-27)


### Features

* **site:** add a landing page per major competing i18n library ([28b3098](https://github.com/sebastian-software/palamedes/commit/28b3098b98e81da16e412b52dec500a6d81c7f6d))
* **site:** add four topic landing pages with structured data ([b89ee08](https://github.com/sebastian-software/palamedes/commit/b89ee085dd391b7948249ab25b976f5143bd12ab))
* **site:** add the /guides hub and per-topic Open Graph cards ([b664dfd](https://github.com/sebastian-software/palamedes/commit/b664dfdb0fcb4c34e3f74266be6dcd6bfdca894b))
* **site:** add the Intlayer comparison, plus Lingo.dev and Fluent sections ([542f536](https://github.com/sebastian-software/palamedes/commit/542f536c5e859ea76514829e8eb77d25f251fa18))
* **site:** argue the comparison pages with conviction ([c0ea33d](https://github.com/sebastian-software/palamedes/commit/c0ea33d5d3ebdd0aee6a7f2478de6957b39ed713))
* **site:** compare General Translation and Tolgee, and map the platforms ([27994d4](https://github.com/sebastian-software/palamedes/commit/27994d4cf0b0e1c4c135a573f0cb3a15e0a5d1a2))
* **site:** explain who funds the i18n libraries, and disclose our own position ([aa26239](https://github.com/sebastian-software/palamedes/commit/aa26239e47bafe4edff24b774f74463898062733))


### Bug Fixes

* **cli:** harden watch mode and polish the command surface ([818643e](https://github.com/sebastian-software/palamedes/commit/818643e2d690eddea09c98f688b8733c5a06bc4a)), closes [#422](https://github.com/sebastian-software/palamedes/issues/422) [#425](https://github.com/sebastian-software/palamedes/issues/425)
* **cli:** report new-root watch failures and unwatch removed roots on reload ([4153d47](https://github.com/sebastian-software/palamedes/commit/4153d47c233a168d2c23e911f67d97a204397c2e))
* **config:** align CLI and JS loaders and validate locale references ([077ab19](https://github.com/sebastian-software/palamedes/commit/077ab1934225b151425ec5488a61f90899196cd1)), closes [#421](https://github.com/sebastian-software/palamedes/issues/421)
* **core-node:** resolve catalog module locale from the path pattern, not the caller ([ae158d6](https://github.com/sebastian-software/palamedes/commit/ae158d6d9fe6dc015ffbcf402338b08ad736c40f)), closes [#409](https://github.com/sebastian-software/palamedes/issues/409)
* **core,plugins:** formatter caching, parser diagnostics, and warning channels ([a2d07bc](https://github.com/sebastian-software/palamedes/commit/a2d07bc2295963a26a80e48ffdfc6c70ff586351)), closes [#426](https://github.com/sebastian-software/palamedes/issues/426)
* **core:** degrade invalid Date values instead of throwing in stringifyValue ([29549b3](https://github.com/sebastian-software/palamedes/commit/29549b3cf6926e8982e7db482158a8ca5a5abc7f))
* **core:** emit protocol-relative canonical URLs instead of hardcoding http ([b94a23a](https://github.com/sebastian-software/palamedes/commit/b94a23a71b2d4f526e7ef35a8b32f9ee4dad9edc)), closes [#418](https://github.com/sebastian-software/palamedes/issues/418)
* **core:** fall through to accept-language on invalid locale cookie ([c73c7e5](https://github.com/sebastian-software/palamedes/commit/c73c7e536246c6f3c7eaede568e52796aba11181)), closes [#413](https://github.com/sebastian-software/palamedes/issues/413)
* **core:** reject absent or non-numeric plural values instead of coercing to 0 ([172059b](https://github.com/sebastian-software/palamedes/commit/172059b260af3b39073c1e0f490a8259c5ba79af)), closes [#414](https://github.com/sebastian-software/palamedes/issues/414)
* **examples:** route 404s, html lang, honest captions, changelog pointers ([eadef57](https://github.com/sebastian-software/palamedes/commit/eadef5744b0dc4addf28416625e423cdb54d4d3b)), closes [#427](https://github.com/sebastian-software/palamedes/issues/427)
* **next-plugin:** apply include/exclude under Turbopack and merge user rules ([5d46aef](https://github.com/sebastian-software/palamedes/commit/5d46aef8810af0a28fa81e6277bbbe0f04ef813d)), closes [#411](https://github.com/sebastian-software/palamedes/issues/411)
* **next-plugin:** declare next ^16 as the supported peer range ([746eec6](https://github.com/sebastian-software/palamedes/commit/746eec602eaab3cd059cd8c7fcf8913851799a46)), closes [#412](https://github.com/sebastian-software/palamedes/issues/412)
* **plugins:** register the Palamedes config as a watch and cache dependency ([696d8aa](https://github.com/sebastian-software/palamedes/commit/696d8aa769507fbc817fb634c8ac0589b42100ec)), closes [#410](https://github.com/sebastian-software/palamedes/issues/410)
* **react,solid:** resolve runtime choice components through the i18n instance ([72ab2a0](https://github.com/sebastian-software/palamedes/commit/72ab2a0a34e950e62789493fcfe81326d6a8780d)), closes [#416](https://github.com/sebastian-software/palamedes/issues/416) [#417](https://github.com/sebastian-software/palamedes/issues/417)
* **scripts:** cover the comparison routes and stop the ratio drifting ([50a4ea3](https://github.com/sebastian-software/palamedes/commit/50a4ea3a969e848fdda46ade293d3f88f73b550d))
* **site:** derive ADR and example counts from the generated stats ([7833294](https://github.com/sebastian-software/palamedes/commit/78332948583b7031709e1a1e09b03edb33c9a366))
* **site:** stop the frame from sizing to content on narrow viewports ([0ba4a69](https://github.com/sebastian-software/palamedes/commit/0ba4a69eef21abc96db92de47bffe17b050650ba))

## [1.6.0](https://github.com/sebastian-software/palamedes/compare/palamedes-v1.5.1...palamedes-v1.6.0) (2026-07-25)

### Features

- **cli:** add binary plugin protocol host support ([fe519b9](https://github.com/sebastian-software/palamedes/commit/fe519b9c641da1c5989d1af0f225ebda99fe41fd))
- **cli:** binary plugin protocol host support (ADR 002) ([c4aeb3b](https://github.com/sebastian-software/palamedes/commit/c4aeb3ba5b4b0475368ee83e905856400ff039d5))
- **core:** initialize every i18n locale ([#432](https://github.com/sebastian-software/palamedes/issues/432)) ([57b6ecd](https://github.com/sebastian-software/palamedes/commit/57b6ecd2eb347d49d1c27b52b757c1da17ad910f))

### Bug Fixes

- add reactive React runtime bridge ([5770cda](https://github.com/sebastian-software/palamedes/commit/5770cda2a66a3b14fbd2e643e6e53a1ee9a2450e))
- clear shared runtime listeners on reset ([8c72577](https://github.com/sebastian-software/palamedes/commit/8c725777be95c300a077c692461ba935cfa4afa7))
- **cli:** fail safely on extraction errors ([3f58b2f](https://github.com/sebastian-software/palamedes/commit/3f58b2fe24b7b6b176a7578c8e7c2faf904d66b4))
- **cli:** fail safely on extraction errors ([3b4557e](https://github.com/sebastian-software/palamedes/commit/3b4557ea8445a8f8490e033a60b826768166ec95))
- **cli:** keep watch mode alive after parse errors ([44829e4](https://github.com/sebastian-software/palamedes/commit/44829e437f76a8a863a294af2130f7e29a73ea2b))
- **core:** export message text nodes ([39398f9](https://github.com/sebastian-software/palamedes/commit/39398f93a48e7b5437436ce75d03841ecb1bb65e))
- **core:** preserve PO translator metadata ([37294b0](https://github.com/sebastian-software/palamedes/commit/37294b01748082c4f22ee99de0336138b458d112))
- **core:** preserve PO translator metadata ([5b69165](https://github.com/sebastian-software/palamedes/commit/5b69165f1f74b11e26b82f5dd429591e12b3b2c9))
- **core:** support ICU apostrophe quoting ([30a3e98](https://github.com/sebastian-software/palamedes/commit/30a3e983a61decb79f3a991224c691e3567e2ea0))
- **core:** support ICU apostrophe quoting ([42d64a8](https://github.com/sebastian-software/palamedes/commit/42d64a81c29f084138f1abc212501ecb794ffce2))
- **deps:** replace dependency @base-ui-components/react with @base-ui/react 1.0.0 ([#397](https://github.com/sebastian-software/palamedes/issues/397)) ([6e7970b](https://github.com/sebastian-software/palamedes/commit/6e7970b527a544dfbdae030e49972de80b21a620))
- **deps:** update lucide monorepo to v1 ([ab70673](https://github.com/sebastian-software/palamedes/commit/ab70673b373834a838cf9922ea20abf4be2a1a59))
- **deps:** update testing-library monorepo to v7 ([6f31062](https://github.com/sebastian-software/palamedes/commit/6f31062dcbe35778529b2eb961dc6212b8b8e27a))
- **extract:** align accessor placeholder names ([91a49e4](https://github.com/sebastian-software/palamedes/commit/91a49e462bcc4a9b6504fa0a306971faa3638576))
- **extract:** align accessor placeholder names ([a3c7692](https://github.com/sebastian-software/palamedes/commit/a3c76922ba54eef7796d4722e0ebcfdae2486681))
- **i18n:** support plural offsets end to end ([7898d2a](https://github.com/sebastian-software/palamedes/commit/7898d2a139f8edcb6aa00c94df4a0feadbbe1f85))
- **i18n:** support plural offsets end to end ([f2dcf9d](https://github.com/sebastian-software/palamedes/commit/f2dcf9d036ea8bb352f004b99933fcecb7c9b0ef))
- **i18n:** validate direct plural offsets ([02ceb31](https://github.com/sebastian-software/palamedes/commit/02ceb31dec06ece1f4e45f00596eb075a5c91f77))
- ignore JSX comments inside Trans ([860ea94](https://github.com/sebastian-software/palamedes/commit/860ea943fd8a74fa096938c9797e6020113f6664))
- ignore JSX comments inside Trans ([c9e1bf3](https://github.com/sebastian-software/palamedes/commit/c9e1bf33c63800733b78a33204f2cd75d382d6ad))
- **react:** add reactive runtime bridge ([#440](https://github.com/sebastian-software/palamedes/issues/440)) ([92a1c45](https://github.com/sebastian-software/palamedes/commit/92a1c451ca6e8d66084af41ecc0e63a492cc28dd)), closes [#415](https://github.com/sebastian-software/palamedes/issues/415)
- **react:** expose server-specific types ([0a95160](https://github.com/sebastian-software/palamedes/commit/0a95160c4d7bbc745a18b3213c25cda3710375b0))
- reconnect Solid runtime after reset ([31fba43](https://github.com/sebastian-software/palamedes/commit/31fba43ea04666d62511e14d7ab87c160f25cfda))
- **runtime:** address SSR review feedback ([c32c45c](https://github.com/sebastian-software/palamedes/commit/c32c45c4544f81f24b22a73e3fdb599ec8b41de6))
- **runtime:** isolate SSR client locale activation ([587fa45](https://github.com/sebastian-software/palamedes/commit/587fa454b8f176346d6fcd6fd10455eb627931f5))
- **runtime:** isolate SSR client locale activation ([82e4cdc](https://github.com/sebastian-software/palamedes/commit/82e4cdcf3d82d9ce8aec882369ab62b2b05fb61e))
- share runtime state across module graphs ([a085f34](https://github.com/sebastian-software/palamedes/commit/a085f34bc9d7cf9884618cb5adfcd301f4666dce))
- share runtime state across module graphs ([52a7e46](https://github.com/sebastian-software/palamedes/commit/52a7e465b0ef1386d2ed6f160b6c65e3b3227374))
- **site:** derive quoted numbers from repo data and repair page metadata ([0cb1eaa](https://github.com/sebastian-software/palamedes/commit/0cb1eaa83932e392c339629bb8026cdee5ee5eda))
- **site:** keep tld matrix cells in provisioning and derive frameworks-page counts ([9405053](https://github.com/sebastian-software/palamedes/commit/9405053fd8c7a8052ce5d482c2d603effbec941f))
- **site:** register route for new cli-binary-plugin API doc ([14695b0](https://github.com/sebastian-software/palamedes/commit/14695b0e61ad1063924310b7d347804b0b5b4179))
- transform macros in Trans component attributes ([5488c13](https://github.com/sebastian-software/palamedes/commit/5488c1374ffda82a6c3c491fbc964d854b4dcfeb))
- transform macros in Trans component attributes ([f7c0df0](https://github.com/sebastian-software/palamedes/commit/f7c0df06222eaea491ce605ef17cfbb5ff82ba77))
- **ui:** make Trans catalog parsing resilient ([f5c5e87](https://github.com/sebastian-software/palamedes/commit/f5c5e87cb1c0e69b445e0a34fb2d593759e1f0af))
- **ui:** make Trans catalog parsing resilient ([9d57535](https://github.com/sebastian-software/palamedes/commit/9d57535c6a941ad08a678e0c56cef8029c13c80c))

## [1.5.1](https://github.com/sebastian-software/palamedes/compare/palamedes-v1.5.0...palamedes-v1.5.1) (2026-07-24)

### Bug Fixes

- correct published TypeScript declarations ([335aae5](https://github.com/sebastian-software/palamedes/commit/335aae57e668f371cdd3978f5a031d301fa512e1))
- correct published TypeScript declarations ([abdf985](https://github.com/sebastian-software/palamedes/commit/abdf9851ace033d33014f01ab56427df68b9fc1e))
- preserve legacy TypeScript resolution ([684f438](https://github.com/sebastian-software/palamedes/commit/684f438354f68cdb7fa05e017ec69b31451eab6f))

## [1.5.0](https://github.com/sebastian-software/palamedes/compare/palamedes-v1.4.0...palamedes-v1.5.0) (2026-07-23)

### Features

- remove deferred messages and enforce eager macro scope ([e4ae4ef](https://github.com/sebastian-software/palamedes/commit/e4ae4ef9d05a02d903a5c5b90930ceb1a63d38c1))

### Bug Fixes

- support interpolated descriptor templates ([cb3e893](https://github.com/sebastian-software/palamedes/commit/cb3e893212cb338d7753d4132461a013d5f41ef0))
- validate interpolated descriptor values ([9bb6eb0](https://github.com/sebastian-software/palamedes/commit/9bb6eb05d0eea17f86b0779211e7331272b6af23))

## [1.4.0](https://github.com/sebastian-software/palamedes/compare/palamedes-v1.3.0...palamedes-v1.4.0) (2026-07-22)

### Features

- add Remix locale catalog flow ([cb111bd](https://github.com/sebastian-software/palamedes/commit/cb111bdd20167151fe86b1de721d9a9de9450c9a))
- add Remix request i18n scope ([aa71708](https://github.com/sebastian-software/palamedes/commit/aa71708a16641795c7fc8f5208a804337b344d80))
- add Remix v3 register hook ([d52e876](https://github.com/sebastian-software/palamedes/commit/d52e876abacd5a6a83ca4fbcf7ce0f75efb12a17))
- **benchmarks:** model realistic extract-time parse volume ([5ec2430](https://github.com/sebastian-software/palamedes/commit/5ec24305c20bfc9ae45d22e59b56b09ec2fae52d))
- **cli:** add explicit namespaced plugin commands ([#368](https://github.com/sebastian-software/palamedes/issues/368)) ([c2bb14e](https://github.com/sebastian-software/palamedes/commit/c2bb14e04c08d7119b95a885c5a4add1504ebf45)), closes [#365](https://github.com/sebastian-software/palamedes/issues/365)
- **remix:** add server API and locale strategy examples ([ed1426e](https://github.com/sebastian-software/palamedes/commit/ed1426e873b446ce20769568adb74d411d2144a0))
- **remix:** load PO catalogs through node hooks ([56d1cc0](https://github.com/sebastian-software/palamedes/commit/56d1cc08b3b85e80bb368ea0fca09404c26c2a1f))
- **site:** polish homepage and add realistic 10k-message benchmark ([cc47a75](https://github.com/sebastian-software/palamedes/commit/cc47a7551aec64b46858c318799814b579bccfb9))

### Bug Fixes

- address Remix review feedback ([18ec453](https://github.com/sebastian-software/palamedes/commit/18ec453b81861980a6cdf3840033bddac6c1db83))
- **benchmarks:** read multiline PO msgids ([a207ed2](https://github.com/sebastian-software/palamedes/commit/a207ed2d3dfef9af49a995f6e09a570f6b6ec641))
- extract interpolated plural branches ([#366](https://github.com/sebastian-software/palamedes/issues/366)) ([306fe64](https://github.com/sebastian-software/palamedes/commit/306fe648b67d11fd344c7164770d895edae4857c)), closes [#363](https://github.com/sebastian-software/palamedes/issues/363)
- **remix:** address server parity review comments ([4ab7db3](https://github.com/sebastian-software/palamedes/commit/4ab7db3ae63d21836249726e59cf525412f66f4d))
- satisfy Remix example lint ([8ea7741](https://github.com/sebastian-software/palamedes/commit/8ea77410b3346c8b77c5fcb5f8c48a1ddefeb6e3))

## [1.3.0](https://github.com/sebastian-software/palamedes/compare/palamedes-v1.2.0...palamedes-v1.3.0) (2026-07-06)

### Features

- **site:** adopt ARDO generated routes ([d31343a](https://github.com/sebastian-software/palamedes/commit/d31343af7a2b650ad58081a39b1eea72d7174e2b))
- **site:** live smoke-test after Pages deploys and canonical palamedes.dev metadata ([43210df](https://github.com/sebastian-software/palamedes/commit/43210df0b4445a03d782671db14571b7cd1b813a))
- **site:** marry the Swiss spec grid with the Palamedes Greek identity ([6577f00](https://github.com/sebastian-software/palamedes/commit/6577f00a5409005023f8dd3f6565d226f1bc568c))
- **site:** route docs links internally ([ee0a074](https://github.com/sebastian-software/palamedes/commit/ee0a074e16f6a6ee25eea13e1dfe3a568ae89c6d))

### Bug Fixes

- **site:** address ARDO review comments ([8b73468](https://github.com/sebastian-software/palamedes/commit/8b7346845ae88dadf6b3e28b844193facd8eecda))
- **site:** address ARDO-coupling review notes on the wordmark and meander ([b248f03](https://github.com/sebastian-software/palamedes/commit/b248f0387913e1cede4dd5f4c4b993266f51bc89))
- **site:** anchor lede removal by offsets and skip headings inside blocks ([d97704c](https://github.com/sebastian-software/palamedes/commit/d97704c2f773048fac10fd02ed4335146aab7cbc))
- **site:** reconcile ARDO chrome with the Swiss-spec-grid design ([948a606](https://github.com/sebastian-software/palamedes/commit/948a606dbb82f9fbddc84962f47fc9693606f453))
- **site:** set hero and CTA headlines in capitals to surface the Hellenic glyphs ([53c66c1](https://github.com/sebastian-software/palamedes/commit/53c66c1b05a0eec7b146c8380388b1354f1591b2))

## [1.2.0](https://github.com/sebastian-software/palamedes/compare/palamedes-v1.1.2...palamedes-v1.2.0) (2026-07-05)

### Features

- **site:** build the Palamedes website — Swiss spec grid with CLI-first hero ([4a98e23](https://github.com/sebastian-software/palamedes/commit/4a98e2387f97b6964322c662b7d29e35d4a39879))
- **site:** deploy the website to GitHub Pages ([11f028d](https://github.com/sebastian-software/palamedes/commit/11f028de6f5d57413c8c772b4d40b672707339e3))
- **site:** scaffold @palamedes/site workspace with prerendered React Router app ([b2d9528](https://github.com/sebastian-software/palamedes/commit/b2d95283b0168b2700f758a687999d24748fef59))
- **site:** serve corrected llms.txt context files from the site root ([a5f0dd2](https://github.com/sebastian-software/palamedes/commit/a5f0dd2301629b753f6ee6da69d60b6893f0c99c)), closes [#309](https://github.com/sebastian-software/palamedes/issues/309)

### Bug Fixes

- render and compile-validate self-closing component placeholders ([#330](https://github.com/sebastian-software/palamedes/issues/330)) ([4441284](https://github.com/sebastian-software/palamedes/commit/4441284d8013fdbba835bf0806b5c413e2bcbee3)), closes [#328](https://github.com/sebastian-software/palamedes/issues/328)

## [1.1.2](https://github.com/sebastian-software/palamedes/compare/palamedes-v1.1.1...palamedes-v1.1.2) (2026-07-05)

### Bug Fixes

- **release:** build musl core-node cdylib with a musl-native toolchain ([#325](https://github.com/sebastian-software/palamedes/issues/325)) ([e1c9e64](https://github.com/sebastian-software/palamedes/commit/e1c9e6473f02bf5d10e9c887a78a5f0006755228))

## [1.1.1](https://github.com/sebastian-software/palamedes/compare/palamedes-v1.1.0...palamedes-v1.1.1) (2026-07-04)

### Bug Fixes

- **release:** build musl node addon with the default self-contained linker ([#300](https://github.com/sebastian-software/palamedes/issues/300)) ([530a778](https://github.com/sebastian-software/palamedes/commit/530a778cdcfdd69a07677c7e76cef09675f705b7))

## [1.1.0](https://github.com/sebastian-software/palamedes/compare/palamedes-v1.0.0...palamedes-v1.1.0) (2026-07-04)

### Features

- **examples:** map the .com tld to en for the tld demos ([#299](https://github.com/sebastian-software/palamedes/issues/299)) ([e4ebbd4](https://github.com/sebastian-software/palamedes/commit/e4ebbd41ee205fc1b07bf2094ff6e7227878a5f4))

### Bug Fixes

- **release:** build musl cdylib addon via target-scoped RUSTFLAGS ([#296](https://github.com/sebastian-software/palamedes/issues/296)) ([c1dcdee](https://github.com/sebastian-software/palamedes/commit/c1dcdee5a14b76500c8c4f08dcd11fd44df3700b))

## [1.0.0](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.11.4...palamedes-v1.0.0) (2026-07-04)

### ⚠ BREAKING CHANGES

- Palamedes 1.0 documents the Ferrocat 2 catalog migration, removes NDJSON migration paths, and promotes stable app-facing surfaces to SemVer.

### Features

- **benchmarks:** add end-to-end workflow comparison ([7888450](https://github.com/sebastian-software/palamedes/commit/788845048a30cf33477cd0959239a1599d81e5a0))
- **cli:** add FCL catalog workflows ([4f9c05d](https://github.com/sebastian-software/palamedes/commit/4f9c05daba2b6b7426172f2b06cd5854dfc3a821))
- **core:** migrate catalogs to Ferrocat FCL ([640ffdd](https://github.com/sebastian-software/palamedes/commit/640ffdd66faee4c2cab47ceee8aca219e4582eba))
- **examples:** add authoritative subdomain locale strategy across all frameworks ([#291](https://github.com/sebastian-software/palamedes/issues/291)) ([1494a0a](https://github.com/sebastian-software/palamedes/commit/1494a0a63fe43762b723f2aa757639bc1b3fc53c))
- **extract:** emit stable origin scopes ([18245db](https://github.com/sebastian-software/palamedes/commit/18245db52863a45a06b4cfbf8e3bb8810014c89b))
- **locale:** add top-level-domain (tld) locale strategy with examples ([#293](https://github.com/sebastian-software/palamedes/issues/293)) ([995a7c1](https://github.com/sebastian-software/palamedes/commit/995a7c102ea9c3b2a73948c4d2b1978f87f63f98))
- **node:** expose FCL catalog formats ([60d5707](https://github.com/sebastian-software/palamedes/commit/60d5707030b12a8e0bb7a365f217e44f0acfaaa4))

### Bug Fixes

- **release:** bump minor instead of major for pre-1.0 breaking changes ([#294](https://github.com/sebastian-software/palamedes/issues/294)) ([c19d831](https://github.com/sebastian-software/palamedes/commit/c19d83163f5b2f625cf2321ced1d7b8202ee1f32))

### Documentation

- prepare Palamedes 1.0 migration ([724067c](https://github.com/sebastian-software/palamedes/commit/724067ca20e9825a6552095508b21cf5aed6d3fb))

## [0.11.4](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.11.3...palamedes-v0.11.4) (2026-07-03)

### Bug Fixes

- **ci:** repair main pipeline formatting and musl addon build ([372dc4f](https://github.com/sebastian-software/palamedes/commit/372dc4f05ac3392c0d1039851147854ff78e33a6))
- **ci:** repair main pipeline formatting and musl addon build ([b1bf8e4](https://github.com/sebastian-software/palamedes/commit/b1bf8e4b13c3106e6706f35640bad64c2e3f885b))

## [0.11.3](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.11.2...palamedes-v0.11.3) (2026-07-02)

### Bug Fixes

- **ci:** unblock native package publish on Windows and musl ([#278](https://github.com/sebastian-software/palamedes/issues/278)) ([bb65f13](https://github.com/sebastian-software/palamedes/commit/bb65f13ea857533109ae5a5ab038e15c4315fccf))

## [0.11.2](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.11.1...palamedes-v0.11.2) (2026-07-02)

### Bug Fixes

- **examples:** allow deployed preview host for tanstack examples ([#276](https://github.com/sebastian-software/palamedes/issues/276)) ([58878fe](https://github.com/sebastian-software/palamedes/commit/58878fe848530c88511d096b4a021a937d124759))

## [0.11.1](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.11.0...palamedes-v0.11.1) (2026-07-02)

### Bug Fixes

- **ci:** build examples container for amd64 (x86_64 target host) ([#274](https://github.com/sebastian-software/palamedes/issues/274)) ([efdf6da](https://github.com/sebastian-software/palamedes/commit/efdf6da74ef49ad51c2d89bbf20849e44b038843))

## [0.11.0](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.10.0...palamedes-v0.11.0) (2026-07-02)

### Features

- **core:** add headless @palamedes/core/locale controls ([5b78fad](https://github.com/sebastian-software/palamedes/commit/5b78fad685990acae23d77e4714c57640db1242f))
- **examples:** run all examples side by side in one container ([#272](https://github.com/sebastian-software/palamedes/issues/272)) ([ba54ef4](https://github.com/sebastian-software/palamedes/commit/ba54ef42774b3cffd5e3dd0f9380b4a5f0a8cfd7))
- **examples:** stop the locale banner from nagging after an explicit choice ([af03646](https://github.com/sebastian-software/palamedes/commit/af03646bcc00669d895bc94abb59dd71f445d495))
- **examples:** unify the example matrix on one shared design ([47a42ab](https://github.com/sebastian-software/palamedes/commit/47a42abbad2607ddc2ab2d3d39719712e15be3cd))

### Bug Fixes

- **cli:** match dot-path includes and warn on empty catalogs ([b2ae950](https://github.com/sebastian-software/palamedes/commit/b2ae95047cbe963ac932f12e660aff4128f40e36))
- **examples:** render route locale switchers as links, style both elements ([2296ebb](https://github.com/sebastian-software/palamedes/commit/2296ebbdb9120b733c9f5f9a459d3d1e195c62d2))
- **release:** handle follow-up native publish failures ([1825938](https://github.com/sebastian-software/palamedes/commit/182593847e22bfd26f5c46230cfdfb6d5c2fb4be))
- **release:** handle follow-up native publish failures ([1345842](https://github.com/sebastian-software/palamedes/commit/1345842e751e8225a7cab9c2801aaa7457e209a0))
- **release:** repair native publish reruns ([0346cef](https://github.com/sebastian-software/palamedes/commit/0346cef61922a7a16f8584d63d34df1a86c95540))
- **release:** repair native publish reruns ([682539c](https://github.com/sebastian-software/palamedes/commit/682539c27b6bdf95e67122c14cdd98024b4a8432))
- **solid:** make Trans and t/plural follow client-side locale switches ([8e5f21e](https://github.com/sebastian-software/palamedes/commit/8e5f21e16084dfab6b205b2c7fcf6656d1b5f1f2))

## [0.10.0](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.9.0...palamedes-v0.10.0) (2026-06-30)

### Features

- **release:** add linux x64 musl native packages ([1d32765](https://github.com/sebastian-software/palamedes/commit/1d32765fb40e9d457ac841b8ca4c7d4b48a2ba9c))
- **release:** add linux x64 musl native packages ([aa37892](https://github.com/sebastian-software/palamedes/commit/aa37892c5d7f65ce7fcf27794711f6422f49cdec))

### Bug Fixes

- make release publishing retryable ([32f4c1f](https://github.com/sebastian-software/palamedes/commit/32f4c1fba1594753922e8b86438a85f774ce6340))
- make release publishing retryable ([ed7fe73](https://github.com/sebastian-software/palamedes/commit/ed7fe7357ec81292b64e48ff90d50f2215ebda37))
- **release:** avoid unknown libc musl fallback ([449434a](https://github.com/sebastian-software/palamedes/commit/449434a2f32878f9f659479edb3217a6a02c4069))
- **release:** tighten native libc selection ([0f78265](https://github.com/sebastian-software/palamedes/commit/0f78265f485c5c7f58cb5464a1a52258e09a29d3))

## [0.9.0](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.8.0...palamedes-v0.9.0) (2026-06-28)

### Features

- make pmds a native rust cli ([a6ab3db](https://github.com/sebastian-software/palamedes/commit/a6ab3dbcc4d1e5ffc84f304363ff02afcf35e40c))
- render vite catalog modules in rust ([07ef4f1](https://github.com/sebastian-software/palamedes/commit/07ef4f148a773c1dea3fecbb29686b144832f762))

## [0.8.0](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.7.12...palamedes-v0.8.0) (2026-06-27)

### Features

- **config:** default PO origins to git root ([c68950e](https://github.com/sebastian-software/palamedes/commit/c68950e378d16fac29a75fa8939c92f458abf1bb))

### Bug Fixes

- **cli:** keep parent include PO origins relative ([bfe5431](https://github.com/sebastian-software/palamedes/commit/bfe543180b7c24543e0bc775a1c2b5371462f72c))

## [0.7.12](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.7.11...palamedes-v0.7.12) (2026-06-27)

### Bug Fixes

- **transform:** keep nested choice branches as expressions ([d204513](https://github.com/sebastian-software/palamedes/commit/d204513e14e4af6e3ee6662481029be1fa03784c))

## [0.7.11](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.7.10...palamedes-v0.7.11) (2026-06-27)

### Bug Fixes

- **transform:** accept fallback choice values ([d261341](https://github.com/sebastian-software/palamedes/commit/d261341da9fc9278a3e03e612edb73a92a61912b))

## [0.7.10](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.7.9...palamedes-v0.7.10) (2026-06-27)

### Bug Fixes

- **transform:** align JSX choice value handling ([7835a58](https://github.com/sebastian-software/palamedes/commit/7835a589c906e8734bd98a8414c70d06b62f9305))

## [0.7.9](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.7.8...palamedes-v0.7.9) (2026-06-26)

### Bug Fixes

- **extract:** match Lingui JSX whitespace at expression boundaries ([2826451](https://github.com/sebastian-software/palamedes/commit/28264516f44e91f4ab9d88aa9f6187bb6cbbfe51)), closes [#246](https://github.com/sebastian-software/palamedes/issues/246)

## [0.7.8](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.7.7...palamedes-v0.7.8) (2026-06-26)

### Bug Fixes

- **extractor:** detect nested macros in JSX expressions ([c529959](https://github.com/sebastian-software/palamedes/commit/c529959b03eefd35836128dfef16f9f7e766d0d3))
- **extractor:** ignore render prop macros in nested scan ([41d507c](https://github.com/sebastian-software/palamedes/commit/41d507ca6552ab1ec33c74c134bfd64e2b7103d3))
- **extractor:** reject nested message macros ([488a4fb](https://github.com/sebastian-software/palamedes/commit/488a4fb63edc5c04fb3381f92ca1c55fc20d985c))
- **transform:** preserve self-closing rich placeholders ([76bf244](https://github.com/sebastian-software/palamedes/commit/76bf244f7be976332622ed188374e4e9e1d50f00))
- **transform:** preserve spaces around inline empty placeholders ([611c554](https://github.com/sebastian-software/palamedes/commit/611c554135ad1a795f5dc58be8eec56476935a27))

## [0.7.7](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.7.6...palamedes-v0.7.7) (2026-06-26)

### Bug Fixes

- **core:** align JSX separator whitespace ([80d87ab](https://github.com/sebastian-software/palamedes/commit/80d87ab1e65ec1b05c330b399afce0ffaacd814b))
- **core:** preserve literal JSX brace text boundaries ([dd26425](https://github.com/sebastian-software/palamedes/commit/dd26425d7778c49ad185ce88b337f0a180c8fca4))

## [0.7.6](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.7.5...palamedes-v0.7.6) (2026-06-26)

### Bug Fixes

- **extractor:** normalize rich-text placeholder whitespace ([65ed86f](https://github.com/sebastian-software/palamedes/commit/65ed86f967763771b3737523f162d66a34c58341))

## [0.7.5](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.7.4...palamedes-v0.7.5) (2026-06-25)

### Bug Fixes

- **transform:** normalize rich-text placeholder whitespace ([9a5fc5a](https://github.com/sebastian-software/palamedes/commit/9a5fc5a6ae69f6ed8ea44d19b166df41a31dedd1))

## [0.7.4](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.7.3...palamedes-v0.7.4) (2026-06-25)

### Performance Improvements

- **core:** release Ferrocat 1.3.1 catalog optimizations ([706ae81](https://github.com/sebastian-software/palamedes/commit/706ae81d54f1b5524659fbc301ee306a0bc33b90))

## [0.7.3](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.7.2...palamedes-v0.7.3) (2026-06-25)

### Bug Fixes

- **extractor:** decode jsx entities in message keys ([54b1c91](https://github.com/sebastian-software/palamedes/commit/54b1c9105bd120ea93d616798a576498a0f5ec62))
- **extractor:** preserve raw jsx expression entities ([a681310](https://github.com/sebastian-software/palamedes/commit/a681310a71ccc5d1cfaeae335dcc1e91b51d1ae6))

## [0.7.2](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.7.1...palamedes-v0.7.2) (2026-06-24)

### Bug Fixes

- **release:** publish supported native targets only ([5dd4db4](https://github.com/sebastian-software/palamedes/commit/5dd4db4084c12b84beab8c40217d10643a3b7738))

## [0.7.1](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.7.0...palamedes-v0.7.1) (2026-06-24)

### Bug Fixes

- **core:** accept literal apostrophes in catalog audit ([71f7a0d](https://github.com/sebastian-software/palamedes/commit/71f7a0d853a9960f330bfff38626e3c855f36630)), closes [#192](https://github.com/sebastian-software/palamedes/issues/192)

## [0.7.0](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.6.0...palamedes-v0.7.0) (2026-06-12)

### Features

- **cli:** add catalog completeness report ([#179](https://github.com/sebastian-software/palamedes/issues/179)) ([37a0934](https://github.com/sebastian-software/palamedes/commit/37a093453b729057e472aa3594d3f6bd0c500b36))
- **cli:** add xliff bridge ([#182](https://github.com/sebastian-software/palamedes/issues/182)) ([0338cab](https://github.com/sebastian-software/palamedes/commit/0338cabf37f2bba1eed90be3053bfecc5db549e6))
- **core-node:** add native target packages ([#174](https://github.com/sebastian-software/palamedes/issues/174)) ([63594e0](https://github.com/sebastian-software/palamedes/commit/63594e068a29a5371ab71bfe1e5fac31267d3058))
- **core:** add runtime fallback hooks ([#175](https://github.com/sebastian-software/palamedes/issues/175)) ([fd68a24](https://github.com/sebastian-software/palamedes/commit/fd68a244ebc63e7d531413fd9b53f60acd1f7b8b))
- **core:** format ICU number and date arguments ([#176](https://github.com/sebastian-software/palamedes/issues/176)) ([5a13d1d](https://github.com/sebastian-software/palamedes/commit/5a13d1d8cb3a71deb1a791585318ca27cf3d2cfd))

### Bug Fixes

- **cli:** report package version ([ee1ad58](https://github.com/sebastian-software/palamedes/commit/ee1ad583690493777a132f5e614ebb507e436e70))
- **cli:** report package version ([a5c9405](https://github.com/sebastian-software/palamedes/commit/a5c940570b2ab9bcd465d282de56be5f26964b14))
- **core:** resolve descriptor ids through active catalog ([#141](https://github.com/sebastian-software/palamedes/issues/141)) ([4447b07](https://github.com/sebastian-software/palamedes/commit/4447b07b7ed80c46fa3dcc21b47c66cb174b312f))
- **next-plugin:** suppress false apostrophe ICU diagnostics ([#139](https://github.com/sebastian-software/palamedes/issues/139)) ([39f7f8b](https://github.com/sebastian-software/palamedes/commit/39f7f8b2908844733f5afb5d3e054e6a81a602e8))
- **runtime:** add request-local server i18n scope ([#142](https://github.com/sebastian-software/palamedes/issues/142)) ([2088f81](https://github.com/sebastian-software/palamedes/commit/2088f81261ab2e24c8cc2d95b0eb5985140ab6ec))
- **transform:** emit valid JSX for macro replacements ([16dfcc4](https://github.com/sebastian-software/palamedes/commit/16dfcc4218a3061029e4d84063aca3b498c4afd0))
- **transform:** validate descriptor macro values ([#180](https://github.com/sebastian-software/palamedes/issues/180)) ([3b37189](https://github.com/sebastian-software/palamedes/commit/3b371890ef721004e5f8ef50a293d5cf99955cd4))

## [0.6.0](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.5.0...palamedes-v0.6.0) (2026-05-22)

### Bug Fixes

- fix transform rich text component placeholders ([90cb1eb](https://github.com/sebastian-software/palamedes/commit/90cb1eb98780dbf4f5aeedb5ef0991233a6d2e84))

## [0.5.0](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.4.0...palamedes-v0.5.0) (2026-05-21)

### Features

- **catalog:** add merge driver support ([6f4757a](https://github.com/sebastian-software/palamedes/commit/6f4757a5ab9b4b5db5ac841ff9c08d071573dd41))

### Performance Improvements

- **extractor:** add native batch extraction path ([09106fe](https://github.com/sebastian-software/palamedes/commit/09106fe4a2f579cb488e265f55933dd2457bd98b))
- **extractor:** use native source hot path ([b2ba469](https://github.com/sebastian-software/palamedes/commit/b2ba4696b1d5745f8bb97740acda7cfc25654173))

## [0.4.0](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.3.0...palamedes-v0.4.0) (2026-05-21)

### Features

- **cli:** add pmds audit command for catalog QA ([25b2f7b](https://github.com/sebastian-software/palamedes/commit/25b2f7b42b0b6e00ddbb9db70fa3556e1699cc27))
- **core:** add catalog audit API backed by Ferrocat ([0b6e6cb](https://github.com/sebastian-software/palamedes/commit/0b6e6cb7e95b882a3884d29c8f1a12caacfd2262))
- **core:** add catalog combine API backed by Ferrocat ([067d88a](https://github.com/sebastian-software/palamedes/commit/067d88a4ad40d9889a4b2e010299fd1af53d0954))
- **core:** expose ICU message metadata validation helpers ([0615ecd](https://github.com/sebastian-software/palamedes/commit/0615ecd7137386399f6a0fb17303ffde1c8c3270))
- reject unnamed placeholders ([efa2c84](https://github.com/sebastian-software/palamedes/commit/efa2c84524e03572d422ee881ff3ba0e5f862a11))

### Bug Fixes

- **catalog:** preserve extracted placeholders ([3364eb4](https://github.com/sebastian-software/palamedes/commit/3364eb4403a6a561369225a297f3faca1334e10d))
- **extractor:** preserve template placeholder source ([a1453dd](https://github.com/sebastian-software/palamedes/commit/a1453ddd89a60ba9b1e703fe3b2752bba5ca8200))
- sourcemap sourcesContent nullability ([8e192c8](https://github.com/sebastian-software/palamedes/commit/8e192c83f0d8f66fcba9e407533d904368326d38))
- transform unicode edit offsets ([964dce3](https://github.com/sebastian-software/palamedes/commit/964dce352ac25b71e3c145e9453f144d216d0b7d))
