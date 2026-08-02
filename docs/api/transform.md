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

The `@palamedes/transform/catalog-loader` subpath exports compatibility helpers
for custom bundlers that already consume compiled catalog artifacts. The
first-party loaders call `@palamedes/core-node` directly, and
`renderCatalogModule()` delegates to that same native generator.

Generated catalog modules import `defineCompiledCatalog()` from
`@palamedes/core/compiled`, so custom integrations must install
`@palamedes/core` as a direct runtime dependency.

Most apps should use a framework plugin instead of this package directly.

## Runtime fallback options

`TransformOptions.keepSourceFallbacks` defaults to `false`. When enabled, the
transform includes the authored message in generated `i18n._()` descriptors and
`Trans` props so missing catalogs can render readable source text.

`stripMessageField` is the deprecated inverse compatibility option. An explicit
`keepSourceFallbacks` value takes precedence; new integrations should use only
the positive option.
