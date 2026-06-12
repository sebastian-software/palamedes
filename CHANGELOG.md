# Changelog

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
