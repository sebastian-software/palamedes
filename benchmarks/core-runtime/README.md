# Compiled Core browser benchmark

This benchmark measures the additional storage created by `i18n.load()` and
string rendering through `i18n._()` in Chromium. It uses production Core builds
and a catalog emitted by the native `renderCatalogModule()` generator.

Build the current checkout and install Playwright Chromium first:

```sh
pnpm build
pnpm exec playwright install chromium
node scripts/benchmark-core-runtime.mjs
```

To compare a change, build `@palamedes/core` in a separate baseline checkout,
then pass its entire `dist` directory (including `shared/`) to the script:

```sh
node scripts/benchmark-core-runtime.mjs /absolute/path/to/baseline/packages/core/dist
```

The script prints JSON containing the environment, every sample, and medians.
It makes no external HTTP requests: Playwright serves the runtime and generated
catalog from local files through request interception.

## Method

- One identical 30,000-message catalog: 10,000 constants, 10,000 interpolations,
  and 10,000 plurals, with distinct message IDs and text.
- Nine fresh browser contexts per variant, alternating baseline/current order.
- Import the runtime and catalog and create an instance before measuring.
  Time one `load()` call. Collect garbage before and after loading and compare
  CDP `Runtime.getHeapUsage().usedSize`. Keep the imported catalog and instance
  reachable throughout the measurement.
- For each message kind, warm up 10,000 lookups, then time 300,000 lookups across
  1,000 IDs. Constants omit values; other messages receive the same values
  object. Consume output lengths and verify checksums across all samples and
  variants, plus exact outputs for one message of each kind.

## Recorded comparison

[Raw samples](results/2026-09-06.json) compare main at `f60d666d` with the direct
compiled-entry storage and constant-string lookup changes. Chromium
151.0.7922.34 ran on macOS arm64 / Apple M1 Pro; the driver used Node 24.15.0.

| Metric (median of nine samples)            |    Baseline |   Changed |
| ------------------------------------------ | ----------: | --------: |
| Additional retained JS heap after `load()` | 1,395,820 B | 795,512 B |
| `load()` for 30,000 messages               |     11.7 ms |   10.7 ms |
| 300,000 constant lookups                   |     31.3 ms |    6.3 ms |
| 300,000 interpolation lookups              |     58.7 ms |   54.6 ms |
| 300,000 plural lookups                     |    260.3 ms |  246.0 ms |

The retained-heap reduction is about 43% of **additional instance storage**,
not total page memory. It is consistent with removing 30,000 per-entry wrapper
objects while keeping the instance's lookup table and source catalog. Constant
lookup time fell about 80% in this workload: these calls now skip the resolved
message object, default values object, string runtime lookup, and `join()`.

This is a Core microbenchmark, not a React/Solid rendering, hydration, network,
module-import, native-memory, or end-to-end application benchmark. GC is forced
outside the timed lookup loops. Smaller timing differences for loading and
dynamic messages should not be treated as guaranteed improvements. Other
engines, devices, catalog sizes, and application workloads need their own
measurements. There is deliberately no timing threshold in CI.
