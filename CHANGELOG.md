# Changelog

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
