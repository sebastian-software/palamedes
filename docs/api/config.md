# `@palamedes/config`

`@palamedes/config` loads and validates Palamedes data config files and legacy
`palamedes.config.*` files.

## Exports

- `defineConfig(config)`
- `loadPalamedesConfig(options?)`
- `loadPalamedesConfigSync(options?)`
- `CONFIG_FILENAMES`
- `expandFallbackLocales(locales, fallbackLocales?)`
- `resolveCatalogPath(config, catalogPath, locale)`
- `resolveConfigPattern(config, pattern)`
- `resolvePalamedesProjectRoot(projectRoot?, fallback?)`
- `resolvePalamedesConfigPath(projectRoot, configPath?)`
- `createPalamedesSourceFilter(include, exclude, { projectRoot })`
- `LoadPalamedesConfigOptions`
- `PalamedesConfig`
- `LoadedPalamedesConfig`
- `PalamedesCatalogConfig`
- `PalamedesPoOutputOptions`
- `PalamedesFallbackLocales`
- `PalamedesSourceReferenceRoot`
- `PalamedesMdxConfig`
- `PalamedesLintConfig`
- `PalamedesSourceRuleLevel`
- `PalamedesPluginDeclaration`
- `PalamedesFilterPattern`
- `PalamedesSourceFilter`
- `PalamedesSourceFilterOptions`

## Config Files

Supported file names:

- `palamedes.yaml`
- `palamedes.yml`
- `palamedes.json`
- `palamedes.toml`
- `palamedes.config.ts`
- `palamedes.config.js`
- `palamedes.config.mjs`
- `palamedes.config.cjs`

See the [configuration reference](../configuration.md) for every field.

## `defineConfig(config)`

Returns the config unchanged while giving TypeScript users a typed authoring
surface.

```ts
import { defineConfig } from "@palamedes/config";

export default defineConfig({
  locales: ["en", "de"],
  sourceLocale: "en",
  referenceScopes: false,
  catalogs: [{ path: "src/locales/{locale}", include: ["src"] }],
  plugins: [["@acme/palamedes-workflows", { policy: "strict" }]],
});
```

`referenceScopes` controls whether catalog source references carry a stable
component or function suffix. It defaults to `true`, producing references such
as `src/App.tsx#CheckoutButton`; the `false` above opts into file-only
references such as `src/App.tsx`. The example sets it explicitly only to show
the field — omit it to keep the default. See
[Source references](../configuration.md#source-references).

PO is the default catalog storage. Opt into FCL by adding `format: "fcl"`:

```ts
export default defineConfig({
  locales: ["en", "de"],
  sourceLocale: "en",
  catalogs: [{ path: "src/locales/{locale}", format: "fcl", include: ["src"] }],
});
```

## `loadPalamedesConfig(options?)`

Searches from `cwd` for a supported config file unless `configPath` is passed.
The returned object includes `configPath`, `rootDir`, `sourceReferenceRoot`,
and the resolved `referenceScopes` boolean.

```ts
const config = await loadPalamedesConfig({ cwd: process.cwd() });
```

Options include `cwd`, `configPath`, and `skipValidation`. Use
`skipValidation` only for tooling that needs to inspect partially-authored
config files.

`plugins` is returned in declaration order. Each entry is a package specifier
or `[specifier, options]`; the native CLI resolves binary plugins relative to a
data config's `configPath`. JavaScript hosts may inspect the same field but do
not execute CLI plugins.

## `loadPalamedesConfigSync(options?)`

Synchronous variant of `loadPalamedesConfig` with the same options, return
shape, and file support (including legacy `palamedes.config.ts`/`.js`). Use it
in hosts that cannot await, such as synchronous loader hooks — the Remix
register hook loads its config this way.

## Shared adapter path helpers

The Vite, Next.js, and Remix adapters resolve their path options through these
helpers, so all three follow the same
[adapter path rules](../configuration.md#adapter-paths).

`resolvePalamedesProjectRoot(projectRoot?, fallback?)` resolves a relative
`projectRoot` from the current working directory and returns `fallback`
(default: the working directory) when it is unset.

`resolvePalamedesConfigPath(projectRoot, configPath?)` resolves a relative
`configPath` from `projectRoot` and keeps an absolute one. It returns
`undefined` without a `configPath`, so the caller keeps automatic discovery.

`createPalamedesSourceFilter(include, exclude, { projectRoot })` returns the
`(id) => boolean` filter behind every adapter's `include` and `exclude`
options. A `PalamedesFilterPattern` is a glob string, a RegExp, an array of
both, `null`, or `undefined`. Relative globs resolve from `projectRoot`; globs
that start with `**` and absolute globs match as written. RegExps test the
file path with forward slashes. IDs containing a NUL byte never match, an
`exclude` match wins, and an empty `include` accepts every file that is not
excluded. This mirrors Vite's `createFilter()` with `projectRoot` as its glob
base.

## Shared dependency and digest helpers

`getConfigDependencies(config)` returns the loaded configuration's dependency
paths. For callers that only provide `configPath`, it falls back to that one
file. Native path spellings are preserved, including Windows paths.

`digestConfig(config)` synchronously hashes the sorted dependency paths and
file contents with SHA-256. NUL separators distinguish paths from contents.
Next and Remix use the shared digest for invalidation, while Vite uses the same
dependency helper for watching. Unreadable dependency files throw so the host
can invalidate its cached configuration and reload it.

```ts
import { digestConfig, getConfigDependencies, loadPalamedesConfig } from "@palamedes/config";

const config = await loadPalamedesConfig();
const watchedFiles = getConfigDependencies(config);
const version = digestConfig(config);
```
