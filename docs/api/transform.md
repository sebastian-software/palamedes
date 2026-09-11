# `@palamedes/transform`

`@palamedes/transform` exposes the low-level macro transformer used by the
plugins.

## Exports

- `transformPalamedesMacros(source, filename, options?)`
- `mightContainPalamedesMacros(source)`
- `findMacroImports(program)`
- `resolveMacroRuntimeModule(runtimeModule?)`
- `mdxFrameworkFor(framework)`
- `PALAMEDES_MACRO_PACKAGES`
- `PALAMEDES_BUNDLER_TRANSFORM_INCLUDE` — shared Vite/Next default covering
  `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`, `.mjs`, and `.cjs`
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
- `PalamedesFramework`

`findMacroImports()` expects a parsed AST program, not a source string. Use
`mightContainPalamedesMacros(source)` as the cheap string pre-check before
parsing.

`resolveMacroRuntimeModule()` selects the runtime import used by generated
macro calls (default `@palamedes/runtime`). `PalamedesFramework` is `"react"`,
`"solid"`, or `"none"`; `mdxFrameworkFor()` maps it to the optional React or
Solid setting understood by MDX compilation.

The `@palamedes/transform/catalog-loader` subpath exports compatibility helpers
for custom bundlers that already consume compiled catalog artifacts. The
first-party loaders call `@palamedes/core-node` directly, and
`renderCatalogModule()` delegates to that same native generator.

Generated catalog modules import `defineCompiledCatalog()` from
`@palamedes/core/compiled`, so custom integrations must install
`@palamedes/core` as a direct runtime dependency.

Most apps should use a framework plugin instead of this package directly.

## Runtime fallback options

`keepSourceFallbacks` retains its legacy option name and defaults to `false`
here. It only controls diagnostic source metadata in generated calls. Set
`keepSourceFallbacks: false` for compact output without authored source text.
V2 package roots and `compiled` aliases both throw on missing compiled entries;
retained metadata never supplies replacement message output. Valid translation
fallbacks are resolved and compiled at build time.

`stripMessageField` is the deprecated inverse compatibility option. An explicit
`keepSourceFallbacks` value takes precedence; new integrations should use only
the positive option.
