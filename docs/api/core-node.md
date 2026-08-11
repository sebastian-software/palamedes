# `@palamedes/core-node`

`@palamedes/core-node` is the JavaScript wrapper around the native Palamedes
core. Most apps use it indirectly through the CLI and plugins.

## Runtime Exports

- `getNativeInfo()`
- `parsePo(source)`
- `parseCatalog(request)`
- `updateCatalogFile(request)`
- `listTranslationCandidates(request)`
- `applyTranslationPatches(request)`
- `isTranslationPatchWriteError(error)`
- `auditCatalogs(config, options?)`
- `deriveMessageMetadata(message, context?)`
- `normalizeMessageMetadata(input)`
- `validateMessageMetadata(input)`
- `combineCatalogs(request)`
- `combineCatalogFiles(request)`
- `mergeCatalogsThreeWay(request)`
- `mergeCatalogFilesThreeWay(request)`
- `compileCatalogArtifact(config, resourcePath)`
- `compileCatalogArtifactSelected(config, resourcePath, compiledIds)`
- `compileCatalogModule(config, resourcePath, options)`
- `renderCatalogModule(messages)`
- `extractMessagesNative(source, filename, mdxOptions?)`
- `analyzeSourceNative(source, filename, options?)`
- `analyzeMdxNative(source, filename, options?)`
- `extractCatalogMessagesFromFiles(request)`
- `transformMacrosNative(source, filename, options?)`

`analyzeMdxNative` returns messages, structured diagnostics, generated
framework JSX, compiled message IDs, and a native source map from one semantic
analysis pass. See [MDX messages](../mdx.md).

`compileCatalogArtifact()` and `compileCatalogArtifactSelected()` include
runtime formatter diagnostics in their `diagnostics` arrays. Unsupported
formatter kinds such as `list`, `duration`, `ago`, and `name` are errors.
Unsupported styles on supported `number`, `date`, and `time` formatters are
warnings because the runtime falls back to default `Intl` formatting.

`compileCatalogModule(config, resourcePath, options)` renders the compiled
catalog artifact as a JavaScript module. The locale is resolved from the
configured catalog path pattern (so layouts like `{locale}/messages.po` work);
the caller-supplied `options.locale` is only a fallback when resolution is
unavailable, and the result reports the effective locale as `locale`. The
first-party Vite, Next, and Remix integrations use this function for `.po`
imports.

`renderCatalogModule(messages)` exposes the same native module generator for
custom integrations that already have a compiled message map. The TypeScript
compatibility helper delegates to this function; there is no second ICU parser
or code generator.

`listTranslationCandidates()` and `applyTranslationPatches()` form the native
translation-review workflow. A failed catalog write can still include completed
per-file outcomes: identify that error with `isTranslationPatchWriteError()`
and read its `report`. See [Translation candidate patches](../translation-candidate-patches.md).

`analyzeSourceNative()` performs the source-level semantic analysis used by
linting and extraction, returning extracted messages and diagnostics in one
native pass.

## Stability

This package is useful for integration tests and custom tooling, but it is a
preview surface. Generated type details may change as the native boundary
evolves.

Use `@palamedes/cli`, `@palamedes/vite-plugin`, or `@palamedes/next-plugin`
when you do not need direct native access.
