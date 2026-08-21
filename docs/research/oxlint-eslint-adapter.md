# Native Diagnostics Through ESLint And Oxlint

Research and implementation snapshot: 2026-08-04.

## Decision

Publish `@palamedes/eslint-plugin` as a Preview package, but keep `pmds lint` as
the stable CI and full-file-format interface.

The package is deliberately an adapter, not a second implementation. Macro
recognition, React/Solid alias handling, message semantics, diagnostic wording,
and source ranges remain in the Rust core. ESLint and Oxlint only provide rule
names, host severity, host suppressions, and editor presentation.

This gives teams normal lint integration without allowing rule semantics to
drift between extraction, `pmds lint`, ESLint, and Oxlint. It also preserves the
product boundary: deterministic authoring defects are open source, while
dictionary, terminology, ambiguity, and AI-assisted review remain outside this
rule surface.

## Why One Compatible Adapter

Oxlint documents its JavaScript plugin API as ESLint v9+ compatible and supports
source APIs, fixes, options, inline directives, and language-server diagnostics.
The API is still alpha and does not support custom parsers/file formats or
type-aware JavaScript rules. See the official
[JavaScript plugin status and support matrix](https://oxc.rs/docs/guide/usage/linter/js-plugins.html).

The adapter therefore uses `@oxlint/plugins`' `eslintCompatPlugin` and
`createOnce` API. Oxlint calls `createOnce` once and can skip a file when the
`before` hook returns `false`; the compatibility wrapper supplies regular
`create` rules to ESLint. This is the path recommended by Oxlint for packages
published to npm. See
[Writing JavaScript plugins](https://oxc.rs/docs/guide/usage/linter/writing-js-plugins.html).
The ESLint integration test exercises the generated `create` path, while the
Oxlint worker test exercises `createOnce`; both report the same native result.

Each facade listens only for `Program`:

1. `before` rejects files that cannot contain Palamedes imports.
2. `Program` asks a shared coordinator for the native analysis.
3. The coordinator enables all native rules once and caches by filename plus a
   SHA-256 source fingerprint.
4. Each facade reports only the native diagnostic code it owns.

This means enabling two or three public rules still performs one native parse
per unchanged file. A source edit changes the fingerprint and invalidates the
entry. Tests exercise the coordinator with distinct source objects to cover
hosts that create a separate context for each enabled rule.

Fatal native analysis errors take a separate path. The coordinator records the
first facade's claim in a `WeakMap<SourceCodeLike, true>` keyed by the host
`SourceCode` object, so an error is emitted once per parse even if cached
analysis is visited by several rules. A new `SourceCode` identity is a new
editor parse and may report again; the weak key does not retain editor source
objects. ESLint-compatible APIs bind
the displayed rule ID to the rule calling `report`, so no neutral coordinator
ID can be emitted without adding a separately enabled public rule. The adapter
therefore uses the first visiting enabled facade and prefixes the diagnostic as
`Palamedes native analysis failed`, rather than presenting it as that semantic
rule's result. Native authoring errors' explicit `at file:line:column` and
`Location: file:line:column` locations are converted from one-based Unicode
scalar coordinates to host UTF-16 positions; malformed or absent locations use
the deterministic file-start fallback.

## Rule Mapping

| Native code                            | ESLint/Oxlint rule                          | Recommended                                          |
| -------------------------------------- | ------------------------------------------- | ---------------------------------------------------- |
| `pmds/no-placeholder-only-message`     | `palamedes/no-placeholder-only-message`     | warning                                              |
| `pmds/no-empty-component-only-message` | `palamedes/no-empty-component-only-message` | off                                                  |
| `pmds/prefer-trans-in-jsx`             | `palamedes/prefer-trans-in-jsx`             | warning in the adapter; informational in `pmds lint` |

`prefer-trans-in-jsx` remains a readability suggestion. Tagged `t` calls are
supported and appropriate outside direct JSX render positions.

The host owns each rule's severity. The facades intentionally accept no custom
options (`meta.schema` is empty): adding parallel JS options would duplicate the
native policy surface and create configuration drift.

Rust reports UTF-8 byte offsets. JavaScript linters use UTF-16 string indices,
so the adapter converts every boundary before calling ESLint's
`SourceCode#getLocFromIndex`. Tests cover ASCII and non-ASCII source, including
an emoji before an aliased macro call, for both React and Solid imports.

## Suppressions And Fixes

The host owns suppression syntax and severity:

```tsx
// eslint-disable-next-line palamedes/no-placeholder-only-message
const eslintValue = t`${status}`

// oxlint-disable-next-line palamedes/no-placeholder-only-message
const oxlintValue = t`${status}`
```

`pmds lint` suppressions stay separate because the native CLI also supports
MDX and can run without either JavaScript linter. There are no adapter fixes in
this version: the diagnostics explain intent, but the native result does not
yet carry a safe edit. In particular, replacing `t` with `Trans` must preserve
metadata and imports and should not be guessed by the facade.

## Performance

Run the checked harness from the repository root:

```bash
pnpm --filter @palamedes/eslint-plugin benchmark
```

The harness generates 250 JSX files with eight placeholder-only messages per
file, runs every path in a fresh process, and reports the first run plus the
median of five subsequent runs. `pmds lint` additionally gets its normal
persistent source-analysis cache on warm runs. Peak RSS comes from the platform
`time` utility when available.

Measured on 2026-08-04 with Node 24.18.0 on macOS arm64:

| Path                               | Cold wall time | Warm median |  Peak RSS |
| ---------------------------------- | -------------: | ----------: | --------: |
| `pmds lint`                        |       127.8 ms |    119.8 ms |  20.3 MiB |
| ESLint adapter                     |       478.2 ms |    482.4 ms | 206.0 MiB |
| Oxlint adapter                     |       312.1 ms |    304.7 ms | 108.1 MiB |
| Parser-free JavaScript lower bound |        91.9 ms |     95.6 ms |  51.6 MiB |

The JavaScript lower bound only reads files and matches tagged templates. It is
not correctness-equivalent; it shows the irreducible Node process and file-I/O
cost. The result supports the intended split: Oxlint is materially lighter than
ESLint for editor integration, while the native CLI remains the fastest and
lowest-memory project scanner.

## Editor/LSP Verification

Oxlint's official extensions launch the project-local `oxlint --lsp`, so the
project must install Oxlint locally. The VS Code/Cursor extension is
`oxc.oxc-vscode`; other supported editor instructions are in the official
[editor setup](https://oxc.rs/docs/guide/usage/linter/editors.html).

Reproduce the adapter path without relying on a screenshot:

1. Install `oxlint` and `@palamedes/eslint-plugin` locally.
2. Add the `jsPlugins` and `rules` configuration shown in the package README.
3. Run `pnpm exec oxlint --config .oxlintrc.json src` and confirm the expected
   `palamedes(...)` diagnostics.
4. Install/enable the Oxc editor extension and open the same JSX/TSX file.
5. Confirm the underline matches the macro call and that an
   `oxlint-disable-next-line` directive removes only the named rule.

The integration test runs the built package inside an actual Oxlint worker and
checks both the diagnostic ID and exact source position. The manual step only
verifies editor transport and rendering.

## Packaging And Failure Modes

- `@oxlint/plugins` is a runtime dependency, as required by the compatibility
  wrapper; ESLint and Oxlint are optional peers so teams install only their
  chosen host.
- `@palamedes/core-node` resolves its platform-specific optional dependency
  relative to itself. This works with hoisted installs and pnpm's isolated
  layout and has been tested inside Oxlint's worker process.
- Supported native targets currently match `@palamedes/core-node`: macOS arm64,
  Linux x64 glibc/musl, Linux arm64 glibc/musl, and Windows x64 MSVC. Missing
  or pruned optional dependencies produce the core binding's actionable load
  error.
- All Palamedes packages publish in lockstep. A mixed older `core-node` version
  may lack the source-analysis binding, so lockfiles should resolve one
  Palamedes release.
- The adapter skips irrelevant files before native analysis, but the host still
  pays its own parsing and process cost.
- Oxlint JavaScript plugins cannot currently supply custom parsers or formats,
  so MDX remains a `pmds lint` responsibility.
- Oxlint's plugin API is alpha. The package remains Preview until that API and
  its editor behavior settle; `pmds lint` is the compatibility fallback.

## Follow-Up Gate

Promote the adapter from Preview only after Oxlint's JavaScript plugin API is no
longer alpha, CI covers the supported OS matrix through the published native
packages, and at least one real project has validated editor restart, monorepo
resolution, and dependency-upgrade behavior. No rule logic should move into
the adapter during that promotion.
