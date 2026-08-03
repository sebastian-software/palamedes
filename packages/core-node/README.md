# @palamedes/core-node

[![npm version](https://img.shields.io/npm/v/%40palamedes%2Fcore-node?logo=npm)](https://www.npmjs.com/package/@palamedes/core-node)
[![CI](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml)
[![Sponsored by Sebastian Software](https://img.shields.io/badge/Sponsored%20by-Sebastian%20Software-0f172a.svg)](https://oss.sebastian-software.com/)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f172a.svg)](https://github.com/sebastian-software/palamedes/blob/main/LICENSE)

The Node.js wrapper around Palamedes' native core.

Use this package when you are building tooling on top of Palamedes and want
direct access to the careful parts of the system: PO/FCL catalog updates,
audits, metadata validation, `.po` parsing, MDX analysis, extraction, and macro
transformation.

The public catalog model is source-string-first: `message + context` is the
semantic identity, while compact lookup keys remain internal compile/runtime
details.

## When To Use This Package

Reach for `@palamedes/core-node` when you are:

- building custom tooling around Palamedes
- integrating the native transform or extractor outside the first-party plugins
- working on Palamedes internals

If you are integrating Palamedes into an app, you usually want one of these instead:

- [`@palamedes/vite-plugin`](https://www.npmjs.com/package/@palamedes/vite-plugin)
- [`@palamedes/next-plugin`](https://www.npmjs.com/package/@palamedes/next-plugin)
- [`@palamedes/cli`](https://www.npmjs.com/package/@palamedes/cli)

## Installation

```bash
pnpm add @palamedes/core-node
```

The package loads one of these platform packages behind the scenes:

- `@palamedes/core-node-darwin-arm64`
- `@palamedes/core-node-linux-x64-gnu`
- `@palamedes/core-node-linux-x64-musl`
- `@palamedes/core-node-linux-arm64-gnu`
- `@palamedes/core-node-win32-x64-msvc`

Linux x64 packages are split by libc, so Alpine and other musl environments use
the musl package while glibc distributions use the GNU package.

## Example

```ts
import {
  combineCatalogFiles,
  getNativeInfo,
  parsePo,
  updateCatalogFile,
} from "@palamedes/core-node"

const info = getNativeInfo()
const po = parsePo(`
msgid ""
msgstr ""
"Language: en\\n"
`)
updateCatalogFile({
  targetPath: "src/locales/en.po",
  locale: "en",
  sourceLocale: "en",
  clean: false,
  po: { lineBreaks: "off" },
  messages: [{ message: "Hello {name}", extractedComments: [], origins: [] }],
})
combineCatalogFiles({
  inputPaths: ["src/locales/de.po", "incoming/de.po"],
  outputPath: "src/locales/de.po",
  format: "po",
  sourceLocale: "en",
})
combineCatalogFiles({
  inputPaths: ["src/locales/de.fcl", "incoming/de.fcl"],
  outputPath: "src/locales/de.fcl",
  format: "fcl",
  sourceLocale: "en",
})

console.log(info.palamedesVersion)
console.log(po.headers.Language)
```

## Available APIs

- `getNativeInfo()`
- `parsePo(source)`
- `updateCatalogFile(request)`
- `parseCatalog(request)`
- `auditCatalogs(config, options?)`
- `deriveMessageMetadata(message, context?)`
- `normalizeMessageMetadata(input)`
- `validateMessageMetadata(input)`
- `combineCatalogs(request)`
- `combineCatalogFiles(request)`
- `compileCatalogArtifact(config, resourcePath)`
- `compileCatalogArtifactSelected(config, resourcePath, compiledIds)`
- `compileCatalogModule(config, resourcePath, options)`
- `renderCatalogModule(messages)`
- `extractMessagesNative(source, filename, mdxOptions?)`
- `analyzeSourceNative(source, filename, options?)`
- `analyzeMdxNative(source, filename, options?)`
- `extractCatalogMessagesFromFiles(request)`
- `transformMacrosNative(source, filename, options?)`

`analyzeMdxNative()` and `transformMacrosNative()` omit authored source-message
fallbacks by default. Pass `keepSourceFallbacks: true` when generated runtime
code must retain them. `stripMessageField` remains a deprecated inverse option
for macro-transform compatibility.

Catalog operations use Ferrocat for parsing, updates, audits, ICU authoring
diagnostics, metadata validation, and deterministic combine workflows. That
keeps custom tooling close to the same semantics used by the official CLI and
framework plugins.

`updateCatalogFile()` accepts an optional PO output control through `po`:
`lineBreaks` (`"auto"` or `"off"`). Catalog order is not configurable —
Ferrocat sorts PO and FCL catalogs by message and then context using the CLDR
root order that `Intl.Collator("en-US")` produces. PO options are rejected for
FCL updates.

The wrapper exposes lowercase public format values (`"po"` and `"fcl"`) while
mapping to the native Ferrocat-backed API internally.

`analyzeMdxNative` uses the same FerroMark-backed semantic workflow as native
catalog extraction. It returns extracted messages, structured source-ranged
diagnostics, React or Solid JSX, compiled message IDs, and a source map.

`analyzeSourceNative` is the shared JS, TS, JSX, TSX, and MDX authoring entry
point. It returns extracted messages plus deterministic diagnostics with a
stable code, lowercase severity, filename, exact UTF-8 byte range, one-based
line and Unicode-scalar column, actionable help, and an optional related range.
The recommended `placeholderOnly` rule defaults to `"warning"`; the narrower
`emptyComponentOnly` rule defaults to `"off"`. Both accept `"off"`, `"info"`,
`"warning"`, or `"error"` through `options.rules`.

`compileCatalogModule(config, resourcePath, options)` is the direct module
rendering API used by the first-party Vite, Next, and Remix `.po` loaders. Pass
the artifact config, the resource path, and options such as `locale`, `pseudoLocale`,
`failOnMissing`, and `failOnCompileError`. The generated module contains one map
of constant strings and executable message functions lowered from Ferrocat's
AST, so valid dynamic messages need neither ICU parsing nor AST interpretation
in the browser.

`renderCatalogModule(messages)` exposes that same canonical native generator
for compatibility helpers and custom integrations that already have a compiled
message map.

## Related Packages

- [`@palamedes/transform`](https://www.npmjs.com/package/@palamedes/transform)
- [`@palamedes/extractor`](https://www.npmjs.com/package/@palamedes/extractor)
- [`@palamedes/vite-plugin`](https://www.npmjs.com/package/@palamedes/vite-plugin)
- [`@palamedes/next-plugin`](https://www.npmjs.com/package/@palamedes/next-plugin)

## License

[![Sebastian Software](https://sebastian-brand.vercel.app/sebastian-software/logo-software.svg)](https://oss.sebastian-software.com/)

MIT © 2026 Sebastian Software
