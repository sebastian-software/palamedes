# Browser runtime footprint

This publication lane answers: how much JavaScript is in Palamedes' shared
browser runtime and its compiled UI entry points? It does **not** measure the
before/after size of a Next.js application or the total size of any demo.

The homepage uses the client profiles in [results.json](./results.json), projected
into its generated data during prebuild. Do not edit that report by hand.

## Reproduce

From the repository root, with the workspace prerequisites and Playwright's
Chromium installed:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm benchmark:browser-runtime --write
pnpm benchmark:browser-runtime
```

`--write` refreshes the report; without it the command repeats the measurements
and verifies the retained bytes, output hashes, input module hashes, and catalog.
Each run builds every runtime profile twice and requires byte-identical output.
This is an artifact-size measurement, with no timing or throughput claim.

`node scripts/benchmark-browser-runtime.mjs --verify-report` checks the source
fingerprint without rebuilding packages or launching a browser. The site build
runs this lightweight guard. Refresh the report whenever one of the hashed
inputs changes:

- the measured packages (`core`, `react`, `solid`, `remix`, and `runtime`):
  their `src/` files, `build.config.ts`, and `package.json`;
- the native compiler: the `palamedes` crate sources in `crates/palamedes/src/`,
  the whole `crates/palamedes-node/` addon crate (sources, `build.rs`, and
  `Cargo.toml`), the root `Cargo.toml`, `rust-toolchain.toml`, and the native
  build scripts (`packages/core-node/scripts/build-native.mjs` and
  `scripts/build-native-lib.mjs`);
- the `@palamedes/core-node` wrapper: its `src/` files, `build.config.ts`, and
  `package.json`;
- `Cargo.lock` and `pnpm-lock.yaml`;
- the harness (`scripts/benchmark-browser-runtime.mjs`,
  `scripts/browser-runtime-source-hash.mjs`, and the profile and client entries
  plus `catalog-only.mjs` in this directory) and the catalog fixture
  `proof/sveltekit-ssr/locales/en.po`.

Files that never reach a build stay out of the fingerprint: JavaScript unit and
type tests (`*.test.*`, `*.type-test.*`), Rust test modules (`tests.rs`,
`test_support.rs`, `tests/`, `*_test.rs`, `*_tests.rs`), the Rust test
fixtures in `crates/palamedes/fixtures/`, and Markdown files such as crate
READMEs. The fingerprint also ignores release metadata: `version` and other
publish-only `package.json` fields, the workspace crates' own manifest and
lockfile versions, and local path dependency release pins. External dependency
requirements and toolchain settings remain inputs, so a release bump alone
keeps the report valid.

Every full measurement rebuilds the native compiler and its Node wrapper before
loading them. An old addon from a previous checkout cannot silently supply
catalog bytes for a report fingerprinted from newer compiler sources.

## Measured boundary

Vite builds one ES2022 production ESM file per profile, minified with Oxc. The
report retains two import selections for each UI runtime:

- `treeShakenProfiles`: client imports for `createI18n`, `defineCompiledCatalog`,
  `getI18n`, and `initializeClientI18n`, plus `Trans` for the UI profiles. Unused
  public exports can disappear. The `*-client.mjs` fixtures define this boundary;
  the homepage displays these rows.
- `profiles`: every export of the compiled Core, universal runtime, their
  `/internal` renderer and generated-code entries, and the selected compiled UI
  entry point. These full API references remain available for
  comparison; they include registration, server binding, reset, locale-switch,
  and standalone formatter APIs where exported.

The selected client APIs still retain the complete default string runtime,
including number, date/time, and plural formatting. These profiles do not assume
an application with literal messages only. They retain the named APIs as exports
so the bundler cannot optimize away the example's initialization or lookup result.

| Profile | Browser entry points                             | Integrations using this UI runtime                                      |
| ------- | ------------------------------------------------ | ----------------------------------------------------------------------- |
| Core    | `@palamedes/core/compiled`, `@palamedes/runtime` | Vue, Nuxt, Svelte, SvelteKit, plain TypeScript                          |
| React   | Core + `@palamedes/react/compiled`               | Next.js, React Router, Waku, TanStack Start with React, Vite with React |
| Solid   | Core + `@palamedes/solid/compiled`               | SolidStart, TanStack Start with Solid, Vite with Solid                  |
| Remix   | Core + `@palamedes/remix/compiled`               | Remix 3 with its own UI runtime                                         |

These are shared runtime profiles, **not framework-by-framework application
deltas or guaranteed size ceilings**. A real application can select different
imports, combine compression with other code, or add other Palamedes APIs.
React/Solid/Remix peer code is external because the host application already
uses that UI framework. Bundled module inventories reject any other dependency
outside the selected Palamedes runtime packages. Native tools, component-file
scanners, and the ICU parser are absent from these browser graphs.

Framework-specific initialization is excluded: for example, the Next loader
generates component bootstrap and dynamic catalog imports, while Remix also
has a client entry and recovery UI. These cost additional bytes. Neither these
profiles nor a server-rendered demo establish their exact cost in a particular
application. To determine an application's added bytes, compare equivalent
production builds before and after integration, holding the framework version,
client boundaries, messages, and compression settings fixed.

## Catalogs are a separate cost

The catalog measurement compiles the **complete English booking demo catalog**
from `proof/sveltekit-ssr/locales/en.po` through the native artifact and module
compiler, including the hashed message IDs used by the adapters. Its source
messages and English translations are identical. The compiled-core import is
external, so the engine is counted only in the runtime profiles.

This is one concrete content fixture, not an average per message. Other text,
languages, message complexity, ID strategies, and selected-message fragments
change the result. The complete catalog is not the initial route's payload.
Do not multiply its size by every configured language: active-locale delivery
and the application's loading strategy determine which catalogs are fetched.

## Validation and limits

Fresh Chromium contexts load every profile with its real framework peer
modules and the compiled catalog. The probe checks client initialization,
universal lookup, a literal message, a plural, number and date formatting, and
the UI renderer export. It does not benchmark UI rendering speed; renderer
semantics remain covered by the package suites.

The catalog imports Core from the same measured profile in each fresh browser
context; the probe does not supply an uncounted second Core bundle. A separate
`catalog-only.mjs` diagnostic verifies that `defineCompiledCatalog` alone retains
none of the three Intl constructors. Its bytes are not a complete i18n runtime.
The report's `retainedIntl` arrays record static constructor references, not a
measurement of per-feature size, execution, or formatter allocations.

The report retains source revision and fingerprint, dirty-worktree status,
Node/Vite/Rolldown/Chromium versions, each emitted file's SHA-256 and module
inventory, and exact byte counts. Marketing-only worktree edits can coexist
with a measurement; the source fingerprint identifies the relevant inputs.

Raw bytes use UTF-8. Gzip uses level 9; Brotli uses quality 11. Each standalone
file is compressed independently. These are compressed artifact sizes, not
network captures, and exclude HTTP headers, source maps, framework peers,
generated host bootstrap, application code, and Intl polyfills. Browsers use
their built-in `Intl`; applications targeting older engines may need extra
polyfills. Homepage kB values use decimal kilobytes and one decimal place.

## Further optimization

See [optimization-notes.md](./optimization-notes.md) for the current findings,
earlier compiler/runtime decisions, and the remaining opportunities. The client
measurements change which APIs are retained; they do not change production
runtime behavior or the compiled catalog ABI.
