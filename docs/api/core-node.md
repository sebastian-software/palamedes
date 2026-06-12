# `@palamedes/core-node`

`@palamedes/core-node` is the JavaScript wrapper around the native Palamedes
core. Most apps use it indirectly through the CLI and plugins.

## Runtime Exports

- `getNativeInfo()`
- `parsePo(source)`
- `parseCatalog(request)`
- `updateCatalogFile(request)`
- `auditCatalogs(request, options?)`
- `deriveMessageMetadata(input)`
- `normalizeMessageMetadata(input)`
- `validateMessageMetadata(input)`
- `combineCatalogs(request)`
- `mergeCatalogFiles(request)`
- `compileCatalogArtifact(request)`
- `compileCatalogArtifactSelected(request)`
- `extractMessagesNative(source, filename)`
- `extractCatalogMessagesFromFiles(request)`
- `transformMacrosNative(source, filename, options?)`

## Stability

This package is useful for integration tests and custom tooling, but it is a
preview surface before 1.0. Generated type details may change as the native
boundary evolves.

Use `@palamedes/cli`, `@palamedes/vite-plugin`, or `@palamedes/next-plugin`
when you do not need direct native access.
