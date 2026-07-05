# Changelog

## [1.1.2](https://github.com/sebastian-software/palamedes/compare/palamedes-v1.1.1...palamedes-v1.1.2) (2026-07-05)


### Bug Fixes

* **release:** build musl core-node cdylib with a musl-native toolchain ([#325](https://github.com/sebastian-software/palamedes/issues/325)) ([e1c9e64](https://github.com/sebastian-software/palamedes/commit/e1c9e6473f02bf5d10e9c887a78a5f0006755228))

## [1.1.1](https://github.com/sebastian-software/palamedes/compare/palamedes-v1.1.0...palamedes-v1.1.1) (2026-07-04)


### Bug Fixes

* **release:** build musl node addon with the default self-contained linker ([#300](https://github.com/sebastian-software/palamedes/issues/300)) ([530a778](https://github.com/sebastian-software/palamedes/commit/530a778cdcfdd69a07677c7e76cef09675f705b7))

## [1.1.0](https://github.com/sebastian-software/palamedes/compare/palamedes-v1.0.0...palamedes-v1.1.0) (2026-07-04)


### Features

* **examples:** map the .com tld to en for the tld demos ([#299](https://github.com/sebastian-software/palamedes/issues/299)) ([e4ebbd4](https://github.com/sebastian-software/palamedes/commit/e4ebbd41ee205fc1b07bf2094ff6e7227878a5f4))


### Bug Fixes

* **release:** build musl cdylib addon via target-scoped RUSTFLAGS ([#296](https://github.com/sebastian-software/palamedes/issues/296)) ([c1dcdee](https://github.com/sebastian-software/palamedes/commit/c1dcdee5a14b76500c8c4f08dcd11fd44df3700b))

## [1.0.0](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.11.4...palamedes-v1.0.0) (2026-07-04)


### ⚠ BREAKING CHANGES

* Palamedes 1.0 documents the Ferrocat 2 catalog migration, removes NDJSON migration paths, and promotes stable app-facing surfaces to SemVer.

### Features

* **benchmarks:** add end-to-end workflow comparison ([7888450](https://github.com/sebastian-software/palamedes/commit/788845048a30cf33477cd0959239a1599d81e5a0))
* **cli:** add FCL catalog workflows ([4f9c05d](https://github.com/sebastian-software/palamedes/commit/4f9c05daba2b6b7426172f2b06cd5854dfc3a821))
* **core:** migrate catalogs to Ferrocat FCL ([640ffdd](https://github.com/sebastian-software/palamedes/commit/640ffdd66faee4c2cab47ceee8aca219e4582eba))
* **examples:** add authoritative subdomain locale strategy across all frameworks ([#291](https://github.com/sebastian-software/palamedes/issues/291)) ([1494a0a](https://github.com/sebastian-software/palamedes/commit/1494a0a63fe43762b723f2aa757639bc1b3fc53c))
* **extract:** emit stable origin scopes ([18245db](https://github.com/sebastian-software/palamedes/commit/18245db52863a45a06b4cfbf8e3bb8810014c89b))
* **locale:** add top-level-domain (tld) locale strategy with examples ([#293](https://github.com/sebastian-software/palamedes/issues/293)) ([995a7c1](https://github.com/sebastian-software/palamedes/commit/995a7c102ea9c3b2a73948c4d2b1978f87f63f98))
* **node:** expose FCL catalog formats ([60d5707](https://github.com/sebastian-software/palamedes/commit/60d5707030b12a8e0bb7a365f217e44f0acfaaa4))


### Bug Fixes

* **release:** bump minor instead of major for pre-1.0 breaking changes ([#294](https://github.com/sebastian-software/palamedes/issues/294)) ([c19d831](https://github.com/sebastian-software/palamedes/commit/c19d83163f5b2f625cf2321ced1d7b8202ee1f32))


### Documentation

* prepare Palamedes 1.0 migration ([724067c](https://github.com/sebastian-software/palamedes/commit/724067ca20e9825a6552095508b21cf5aed6d3fb))

## [0.11.4](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.11.3...palamedes-v0.11.4) (2026-07-03)


### Bug Fixes

* **ci:** repair main pipeline formatting and musl addon build ([372dc4f](https://github.com/sebastian-software/palamedes/commit/372dc4f05ac3392c0d1039851147854ff78e33a6))
* **ci:** repair main pipeline formatting and musl addon build ([b1bf8e4](https://github.com/sebastian-software/palamedes/commit/b1bf8e4b13c3106e6706f35640bad64c2e3f885b))

## [0.11.3](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.11.2...palamedes-v0.11.3) (2026-07-02)


### Bug Fixes

* **ci:** unblock native package publish on Windows and musl ([#278](https://github.com/sebastian-software/palamedes/issues/278)) ([bb65f13](https://github.com/sebastian-software/palamedes/commit/bb65f13ea857533109ae5a5ab038e15c4315fccf))

## [0.11.2](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.11.1...palamedes-v0.11.2) (2026-07-02)


### Bug Fixes

* **examples:** allow deployed preview host for tanstack examples ([#276](https://github.com/sebastian-software/palamedes/issues/276)) ([58878fe](https://github.com/sebastian-software/palamedes/commit/58878fe848530c88511d096b4a021a937d124759))

## [0.11.1](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.11.0...palamedes-v0.11.1) (2026-07-02)


### Bug Fixes

* **ci:** build examples container for amd64 (x86_64 target host) ([#274](https://github.com/sebastian-software/palamedes/issues/274)) ([efdf6da](https://github.com/sebastian-software/palamedes/commit/efdf6da74ef49ad51c2d89bbf20849e44b038843))

## [0.11.0](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.10.0...palamedes-v0.11.0) (2026-07-02)


### Features

* **core:** add headless @palamedes/core/locale controls ([5b78fad](https://github.com/sebastian-software/palamedes/commit/5b78fad685990acae23d77e4714c57640db1242f))
* **examples:** run all examples side by side in one container ([#272](https://github.com/sebastian-software/palamedes/issues/272)) ([ba54ef4](https://github.com/sebastian-software/palamedes/commit/ba54ef42774b3cffd5e3dd0f9380b4a5f0a8cfd7))
* **examples:** stop the locale banner from nagging after an explicit choice ([af03646](https://github.com/sebastian-software/palamedes/commit/af03646bcc00669d895bc94abb59dd71f445d495))
* **examples:** unify the example matrix on one shared design ([47a42ab](https://github.com/sebastian-software/palamedes/commit/47a42abbad2607ddc2ab2d3d39719712e15be3cd))


### Bug Fixes

* **cli:** match dot-path includes and warn on empty catalogs ([b2ae950](https://github.com/sebastian-software/palamedes/commit/b2ae95047cbe963ac932f12e660aff4128f40e36))
* **examples:** render route locale switchers as links, style both elements ([2296ebb](https://github.com/sebastian-software/palamedes/commit/2296ebbdb9120b733c9f5f9a459d3d1e195c62d2))
* **release:** handle follow-up native publish failures ([1825938](https://github.com/sebastian-software/palamedes/commit/182593847e22bfd26f5c46230cfdfb6d5c2fb4be))
* **release:** handle follow-up native publish failures ([1345842](https://github.com/sebastian-software/palamedes/commit/1345842e751e8225a7cab9c2801aaa7457e209a0))
* **release:** repair native publish reruns ([0346cef](https://github.com/sebastian-software/palamedes/commit/0346cef61922a7a16f8584d63d34df1a86c95540))
* **release:** repair native publish reruns ([682539c](https://github.com/sebastian-software/palamedes/commit/682539c27b6bdf95e67122c14cdd98024b4a8432))
* **solid:** make Trans and t/plural follow client-side locale switches ([8e5f21e](https://github.com/sebastian-software/palamedes/commit/8e5f21e16084dfab6b205b2c7fcf6656d1b5f1f2))

## [0.10.0](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.9.0...palamedes-v0.10.0) (2026-06-30)


### Features

* **release:** add linux x64 musl native packages ([1d32765](https://github.com/sebastian-software/palamedes/commit/1d32765fb40e9d457ac841b8ca4c7d4b48a2ba9c))
* **release:** add linux x64 musl native packages ([aa37892](https://github.com/sebastian-software/palamedes/commit/aa37892c5d7f65ce7fcf27794711f6422f49cdec))


### Bug Fixes

* make release publishing retryable ([32f4c1f](https://github.com/sebastian-software/palamedes/commit/32f4c1fba1594753922e8b86438a85f774ce6340))
* make release publishing retryable ([ed7fe73](https://github.com/sebastian-software/palamedes/commit/ed7fe7357ec81292b64e48ff90d50f2215ebda37))
* **release:** avoid unknown libc musl fallback ([449434a](https://github.com/sebastian-software/palamedes/commit/449434a2f32878f9f659479edb3217a6a02c4069))
* **release:** tighten native libc selection ([0f78265](https://github.com/sebastian-software/palamedes/commit/0f78265f485c5c7f58cb5464a1a52258e09a29d3))

## [0.9.0](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.8.0...palamedes-v0.9.0) (2026-06-28)


### Features

* make pmds a native rust cli ([a6ab3db](https://github.com/sebastian-software/palamedes/commit/a6ab3dbcc4d1e5ffc84f304363ff02afcf35e40c))
* render vite catalog modules in rust ([07ef4f1](https://github.com/sebastian-software/palamedes/commit/07ef4f148a773c1dea3fecbb29686b144832f762))

## [0.8.0](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.7.12...palamedes-v0.8.0) (2026-06-27)


### Features

* **config:** default PO origins to git root ([c68950e](https://github.com/sebastian-software/palamedes/commit/c68950e378d16fac29a75fa8939c92f458abf1bb))


### Bug Fixes

* **cli:** keep parent include PO origins relative ([bfe5431](https://github.com/sebastian-software/palamedes/commit/bfe543180b7c24543e0bc775a1c2b5371462f72c))

## [0.7.12](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.7.11...palamedes-v0.7.12) (2026-06-27)


### Bug Fixes

* **transform:** keep nested choice branches as expressions ([d204513](https://github.com/sebastian-software/palamedes/commit/d204513e14e4af6e3ee6662481029be1fa03784c))

## [0.7.11](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.7.10...palamedes-v0.7.11) (2026-06-27)


### Bug Fixes

* **transform:** accept fallback choice values ([d261341](https://github.com/sebastian-software/palamedes/commit/d261341da9fc9278a3e03e612edb73a92a61912b))

## [0.7.10](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.7.9...palamedes-v0.7.10) (2026-06-27)


### Bug Fixes

* **transform:** align JSX choice value handling ([7835a58](https://github.com/sebastian-software/palamedes/commit/7835a589c906e8734bd98a8414c70d06b62f9305))

## [0.7.9](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.7.8...palamedes-v0.7.9) (2026-06-26)


### Bug Fixes

* **extract:** match Lingui JSX whitespace at expression boundaries ([2826451](https://github.com/sebastian-software/palamedes/commit/28264516f44e91f4ab9d88aa9f6187bb6cbbfe51)), closes [#246](https://github.com/sebastian-software/palamedes/issues/246)

## [0.7.8](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.7.7...palamedes-v0.7.8) (2026-06-26)


### Bug Fixes

* **extractor:** detect nested macros in JSX expressions ([c529959](https://github.com/sebastian-software/palamedes/commit/c529959b03eefd35836128dfef16f9f7e766d0d3))
* **extractor:** ignore render prop macros in nested scan ([41d507c](https://github.com/sebastian-software/palamedes/commit/41d507ca6552ab1ec33c74c134bfd64e2b7103d3))
* **extractor:** reject nested message macros ([488a4fb](https://github.com/sebastian-software/palamedes/commit/488a4fb63edc5c04fb3381f92ca1c55fc20d985c))
* **transform:** preserve self-closing rich placeholders ([76bf244](https://github.com/sebastian-software/palamedes/commit/76bf244f7be976332622ed188374e4e9e1d50f00))
* **transform:** preserve spaces around inline empty placeholders ([611c554](https://github.com/sebastian-software/palamedes/commit/611c554135ad1a795f5dc58be8eec56476935a27))

## [0.7.7](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.7.6...palamedes-v0.7.7) (2026-06-26)


### Bug Fixes

* **core:** align JSX separator whitespace ([80d87ab](https://github.com/sebastian-software/palamedes/commit/80d87ab1e65ec1b05c330b399afce0ffaacd814b))
* **core:** preserve literal JSX brace text boundaries ([dd26425](https://github.com/sebastian-software/palamedes/commit/dd26425d7778c49ad185ce88b337f0a180c8fca4))

## [0.7.6](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.7.5...palamedes-v0.7.6) (2026-06-26)


### Bug Fixes

* **extractor:** normalize rich-text placeholder whitespace ([65ed86f](https://github.com/sebastian-software/palamedes/commit/65ed86f967763771b3737523f162d66a34c58341))

## [0.7.5](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.7.4...palamedes-v0.7.5) (2026-06-25)


### Bug Fixes

* **transform:** normalize rich-text placeholder whitespace ([9a5fc5a](https://github.com/sebastian-software/palamedes/commit/9a5fc5a6ae69f6ed8ea44d19b166df41a31dedd1))

## [0.7.4](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.7.3...palamedes-v0.7.4) (2026-06-25)


### Performance Improvements

* **core:** release Ferrocat 1.3.1 catalog optimizations ([706ae81](https://github.com/sebastian-software/palamedes/commit/706ae81d54f1b5524659fbc301ee306a0bc33b90))

## [0.7.3](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.7.2...palamedes-v0.7.3) (2026-06-25)


### Bug Fixes

* **extractor:** decode jsx entities in message keys ([54b1c91](https://github.com/sebastian-software/palamedes/commit/54b1c9105bd120ea93d616798a576498a0f5ec62))
* **extractor:** preserve raw jsx expression entities ([a681310](https://github.com/sebastian-software/palamedes/commit/a681310a71ccc5d1cfaeae335dcc1e91b51d1ae6))

## [0.7.2](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.7.1...palamedes-v0.7.2) (2026-06-24)


### Bug Fixes

* **release:** publish supported native targets only ([5dd4db4](https://github.com/sebastian-software/palamedes/commit/5dd4db4084c12b84beab8c40217d10643a3b7738))

## [0.7.1](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.7.0...palamedes-v0.7.1) (2026-06-24)


### Bug Fixes

* **core:** accept literal apostrophes in catalog audit ([71f7a0d](https://github.com/sebastian-software/palamedes/commit/71f7a0d853a9960f330bfff38626e3c855f36630)), closes [#192](https://github.com/sebastian-software/palamedes/issues/192)

## [0.7.0](https://github.com/sebastian-software/palamedes/compare/palamedes-v0.6.0...palamedes-v0.7.0) (2026-06-12)


### Features

* **cli:** add catalog completeness report ([#179](https://github.com/sebastian-software/palamedes/issues/179)) ([37a0934](https://github.com/sebastian-software/palamedes/commit/37a093453b729057e472aa3594d3f6bd0c500b36))
* **cli:** add xliff bridge ([#182](https://github.com/sebastian-software/palamedes/issues/182)) ([0338cab](https://github.com/sebastian-software/palamedes/commit/0338cabf37f2bba1eed90be3053bfecc5db549e6))
* **core-node:** add native target packages ([#174](https://github.com/sebastian-software/palamedes/issues/174)) ([63594e0](https://github.com/sebastian-software/palamedes/commit/63594e068a29a5371ab71bfe1e5fac31267d3058))
* **core:** add runtime fallback hooks ([#175](https://github.com/sebastian-software/palamedes/issues/175)) ([fd68a24](https://github.com/sebastian-software/palamedes/commit/fd68a244ebc63e7d531413fd9b53f60acd1f7b8b))
* **core:** format ICU number and date arguments ([#176](https://github.com/sebastian-software/palamedes/issues/176)) ([5a13d1d](https://github.com/sebastian-software/palamedes/commit/5a13d1d8cb3a71deb1a791585318ca27cf3d2cfd))


### Bug Fixes

* **cli:** report package version ([ee1ad58](https://github.com/sebastian-software/palamedes/commit/ee1ad583690493777a132f5e614ebb507e436e70))
* **cli:** report package version ([a5c9405](https://github.com/sebastian-software/palamedes/commit/a5c940570b2ab9bcd465d282de56be5f26964b14))
* **core:** resolve descriptor ids through active catalog ([#141](https://github.com/sebastian-software/palamedes/issues/141)) ([4447b07](https://github.com/sebastian-software/palamedes/commit/4447b07b7ed80c46fa3dcc21b47c66cb174b312f))
* **next-plugin:** suppress false apostrophe ICU diagnostics ([#139](https://github.com/sebastian-software/palamedes/issues/139)) ([39f7f8b](https://github.com/sebastian-software/palamedes/commit/39f7f8b2908844733f5afb5d3e054e6a81a602e8))
* **runtime:** add request-local server i18n scope ([#142](https://github.com/sebastian-software/palamedes/issues/142)) ([2088f81](https://github.com/sebastian-software/palamedes/commit/2088f81261ab2e24c8cc2d95b0eb5985140ab6ec))
* **transform:** emit valid JSX for macro replacements ([16dfcc4](https://github.com/sebastian-software/palamedes/commit/16dfcc4218a3061029e4d84063aca3b498c4afd0))
* **transform:** validate descriptor macro values ([#180](https://github.com/sebastian-software/palamedes/issues/180)) ([3b37189](https://github.com/sebastian-software/palamedes/commit/3b371890ef721004e5f8ef50a293d5cf99955cd4))

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
