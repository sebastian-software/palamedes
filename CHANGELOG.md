# Changelog

## Unreleased

### Compatibility Notes

- Production integrations now strip inline source-message fallbacks from macro
  and MDX output by default. Vite preserves them during `vite serve`; Vite
  builds, Next production, and Remix production emit compact lookup calls.
  Set `keepSourceFallbacks: true` on the host adapter to preserve the earlier
  behavior. The low-level transform uses the same stripped default;
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

- Generated PO and FCL catalog modules now carry build-time ICU parser output,
  so valid catalog messages bypass first-render parsing in the browser. Public
  catalog values remain strings; manual and invalid string catalogs retain the
  bounded lazy parser and existing fallback behavior.

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
