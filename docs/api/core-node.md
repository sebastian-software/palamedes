# `@palamedes/core-node`

`@palamedes/core-node` is the JavaScript wrapper around the native Palamedes
core. Most apps use it indirectly through the CLI and plugins.

## Runtime Exports

- `getNativeInfo()`
- `parsePo(source)`
- `parseCatalog(request)`
- `updateCatalogFile(request)`
- `auditCatalogs(config, options?)`
- `deriveMessageMetadata(message, context?)`
- `normalizeMessageMetadata(input)`
- `validateMessageMetadata(input)`
- `combineCatalogs(request)`
- `combineCatalogFiles(request)`
- `compileCatalogArtifact(config, resourcePath)`
- `compileCatalogArtifactSelected(config, resourcePath, compiledIds)`
- `compileCatalogModule(config, resourcePath, options)`
- `extractMessagesNative(source, filename)`
- `extractCatalogMessagesFromFiles(request)`
- `transformMacrosNative(source, filename, options?)`

`compileCatalogArtifact()` and `compileCatalogArtifactSelected()` include
runtime formatter diagnostics in their `diagnostics` arrays. Unsupported
formatter kinds such as `list`, `duration`, `ago`, and `name` are errors.
Unsupported styles on supported `number`, `date`, and `time` formatters are
warnings because the runtime falls back to default `Intl` formatting.

## Stability

This package is useful for integration tests and custom tooling, but it is a
preview surface. Generated type details may change as the native boundary
evolves.

Use `@palamedes/cli`, `@palamedes/vite-plugin`, or `@palamedes/next-plugin`
when you do not need direct native access.
