# Browser runtime footprint

This publication lane answers: how much JavaScript is in Palamedes' shared
browser runtime and its compiled UI entry points? It does **not** measure the
before/after size of a Next.js application or the total size of any demo.

The homepage reads [results.json](./results.json) directly. Do not edit that
generated report by hand.

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
runs this lightweight guard. Refresh the report after changing the selected
runtime sources, dependency lockfile, harness, or catalog fixture. Rerun the full
measurement when changing the native catalog compiler; its version is pinned by
the report's source commit, rather than every unrelated Rust edit invalidating
the runtime-size report.

## Measured boundary

Vite builds one ES2022 production ESM file per profile, minified with Oxc. Every
public export of each selected entry point is retained, rather than choosing
one small message call that lets most features disappear. This includes the
compiled engine's formatting helpers and the universal runtime's registration
and bootstrap APIs. The UI profiles add their complete compiled entry point,
including locale-switch helpers where exported. Read the four entry fixtures
beside this file for the exact imports.

| Profile | Browser entry points                             | Integrations using this UI runtime                                      |
| ------- | ------------------------------------------------ | ----------------------------------------------------------------------- |
| Core    | `@palamedes/core/compiled`, `@palamedes/runtime` | Vue, Nuxt, Svelte, SvelteKit, plain TypeScript                          |
| React   | Core + `@palamedes/react/compiled`               | Next.js, React Router, Waku, TanStack Start with React, Vite with React |
| Solid   | Core + `@palamedes/solid/compiled`               | SolidStart, TanStack Start with Solid, Vite with Solid                  |
| Remix   | Core + `@palamedes/remix/compiled`               | Remix 3 with its own UI runtime                                         |

These are shared runtime profiles, **not framework-by-framework application
deltas or guaranteed size ceilings**. A real application can tree-shake unused
exports, combine compression with other code, or add other Palamedes APIs.
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
