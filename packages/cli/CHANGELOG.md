# Changelog

## [0.6.0](https://github.com/sebastian-software/palamedes/compare/cli-v0.5.0...cli-v0.6.0) (2026-05-22)

### Features

- add @palamedes/cli — extract command with watch mode ([f0f2164](https://github.com/sebastian-software/palamedes/commit/f0f216479ef2bcece5f9a9b23fedd2e62cc026ac))
- add initial rust core spike ([cb9e126](https://github.com/sebastian-software/palamedes/commit/cb9e1265f1b06b6ea15416e29324e157ccd98c12))
- **catalog:** add merge driver support ([6f4757a](https://github.com/sebastian-software/palamedes/commit/6f4757a5ab9b4b5db5ac841ff9c08d071573dd41))
- **cli:** add pmds audit command for catalog QA ([25b2f7b](https://github.com/sebastian-software/palamedes/commit/25b2f7b42b0b6e00ddbb9db70fa3556e1699cc27))
- complete palamedes-first lingui migration ([fc1ac6f](https://github.com/sebastian-software/palamedes/commit/fc1ac6f9c7b8b8a3e609f72715f04b452243126a))
- **config:** add palamedes config loading ([ff5d356](https://github.com/sebastian-software/palamedes/commit/ff5d3560881903e5371497a6a67ccf2032978fd7))
- reject unnamed placeholders ([efa2c84](https://github.com/sebastian-software/palamedes/commit/efa2c84524e03572d422ee881ff3ba0e5f862a11))

### Bug Fixes

- **catalog:** preserve extracted placeholders ([3364eb4](https://github.com/sebastian-software/palamedes/commit/3364eb4403a6a561369225a297f3faca1334e10d))
- **cli:** make workspace bin resilient ([c1aaa28](https://github.com/sebastian-software/palamedes/commit/c1aaa28ad5a1f43348c0bb8ed460766d2f536e0f))
- **extractor:** preserve template placeholder source ([a1453dd](https://github.com/sebastian-software/palamedes/commit/a1453ddd89a60ba9b1e703fe3b2752bba5ca8200))
- restore root typecheck ([da3057b](https://github.com/sebastian-software/palamedes/commit/da3057bd130f49976fbebce7a67720cebdf3a98b))

### Performance Improvements

- **extractor:** add native batch extraction path ([09106fe](https://github.com/sebastian-software/palamedes/commit/09106fe4a2f579cb488e265f55933dd2457bd98b))
- **extractor:** use native source hot path ([b2ba469](https://github.com/sebastian-software/palamedes/commit/b2ba4696b1d5745f8bb97740acda7cfc25654173))

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @palamedes/config bumped to 0.6.0
    - @palamedes/core-node bumped to 0.6.0

## [0.5.0](https://github.com/sebastian-software/palamedes/compare/cli-v0.4.0...cli-v0.5.0) (2026-05-21)

### Features

- **catalog:** add merge driver support ([6f4757a](https://github.com/sebastian-software/palamedes/commit/6f4757a5ab9b4b5db5ac841ff9c08d071573dd41))

### Performance Improvements

- **extractor:** add native batch extraction path ([09106fe](https://github.com/sebastian-software/palamedes/commit/09106fe4a2f579cb488e265f55933dd2457bd98b))
- **extractor:** use native source hot path ([b2ba469](https://github.com/sebastian-software/palamedes/commit/b2ba4696b1d5745f8bb97740acda7cfc25654173))

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @palamedes/config bumped to 0.5.0
    - @palamedes/core-node bumped to 0.5.0

## [0.4.0](https://github.com/sebastian-software/palamedes/compare/cli-v0.3.0...cli-v0.4.0) (2026-05-21)

### Features

- **cli:** add pmds audit command for catalog QA ([25b2f7b](https://github.com/sebastian-software/palamedes/commit/25b2f7b42b0b6e00ddbb9db70fa3556e1699cc27))
- reject unnamed placeholders ([efa2c84](https://github.com/sebastian-software/palamedes/commit/efa2c84524e03572d422ee881ff3ba0e5f862a11))

### Bug Fixes

- **catalog:** preserve extracted placeholders ([3364eb4](https://github.com/sebastian-software/palamedes/commit/3364eb4403a6a561369225a297f3faca1334e10d))
- **extractor:** preserve template placeholder source ([a1453dd](https://github.com/sebastian-software/palamedes/commit/a1453ddd89a60ba9b1e703fe3b2752bba5ca8200))

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @palamedes/config bumped to 0.4.0
    - @palamedes/core-node bumped to 0.4.0
    - @palamedes/extractor bumped to 0.4.0

## [0.3.0](https://github.com/sebastian-software/palamedes/compare/cli-v0.2.0...cli-v0.3.0) (2026-05-07)

### Miscellaneous Chores

- **cli:** Synchronize palamedes versions

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @palamedes/config bumped to 0.3.0
    - @palamedes/core-node bumped to 0.3.0
    - @palamedes/extractor bumped to 0.3.0

## [0.2.0](https://github.com/sebastian-software/palamedes/compare/cli-v0.1.1...cli-v0.2.0) (2026-05-07)

### Features

- complete palamedes-first lingui migration ([fc1ac6f](https://github.com/sebastian-software/palamedes/commit/fc1ac6f9c7b8b8a3e609f72715f04b452243126a))
- **config:** add palamedes config loading ([ff5d356](https://github.com/sebastian-software/palamedes/commit/ff5d3560881903e5371497a6a67ccf2032978fd7))

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @palamedes/core-node bumped to 0.2.0
    - @palamedes/extractor bumped to 0.2.0

## [0.1.1](https://github.com/sebastian-software/palamedes/compare/cli-v0.1.0...cli-v0.1.1) (2026-03-11)

### Miscellaneous Chores

- **cli:** Synchronize palamedes versions

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @palamedes/extractor bumped to 0.1.1

## [0.1.0](https://github.com/sebastian-software/palamedes/compare/cli-v0.0.1...cli-v0.1.0) (2026-03-11)

### Features

- add @palamedes/cli — extract command with watch mode ([f0f2164](https://github.com/sebastian-software/palamedes/commit/f0f216479ef2bcece5f9a9b23fedd2e62cc026ac))
- add initial rust core spike ([cb9e126](https://github.com/sebastian-software/palamedes/commit/cb9e1265f1b06b6ea15416e29324e157ccd98c12))

### Bug Fixes

- **cli:** make workspace bin resilient ([c1aaa28](https://github.com/sebastian-software/palamedes/commit/c1aaa28ad5a1f43348c0bb8ed460766d2f536e0f))
- restore root typecheck ([da3057b](https://github.com/sebastian-software/palamedes/commit/da3057bd130f49976fbebce7a67720cebdf3a98b))

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @palamedes/extractor bumped to 0.1.0
