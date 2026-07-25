# `@palamedes/transform`

`@palamedes/transform` exposes the low-level macro transformer used by the
plugins.

## Exports

- `transformPalamedesMacros(source, filename, options?)`
- `mightContainPalamedesMacros(source)`
- `findMacroImports(program)`
- `PALAMEDES_MACRO_PACKAGES`
- `JS_MACROS`
- `JSX_MACROS`
- `TransformOptions`
- `TransformResult`
- `SourceMap`
- `createCatalogLoaderResult(result, options)`
- `renderCatalogModule(messages)`
- `createCompileErrorMessage(locale, diagnostics)`
- `createDiagnosticMessage(locale, diagnostics)`
- `createMissingErrorMessage(locale, missingMessages)`
- `CatalogCompileArtifactResult`
- `CatalogDiagnostic`
- `CatalogLoaderOptions`
- `CatalogLoaderResult`
- `CatalogSourceKey`
- `MissingCatalogMessage`

`findMacroImports()` expects a parsed AST program, not a source string. Use
`mightContainPalamedesMacros(source)` as the cheap string pre-check before
parsing.

The `@palamedes/transform/catalog-loader` subpath exports the catalog-loader
helpers used by the first-party Vite and Next plugins. They are useful when a
custom bundler needs to render compiled catalog artifacts into JavaScript
modules with the same diagnostics and missing-catalog messages.

Most apps should use a framework plugin instead of this package directly.
