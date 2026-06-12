# `@palamedes/transform`

`@palamedes/transform` exposes the low-level macro transformer used by the
plugins.

## Exports

- `transformPalamedesMacros(source, filename, options?)`
- `mightContainPalamedesMacros(source)`
- `findMacroImports(source)`
- `PALAMEDES_MACRO_PACKAGES`
- `JS_MACROS`
- `JSX_MACROS`
- `TransformOptions`
- `TransformResult`
- `SourceMap`

Most apps should use a framework plugin instead of this package directly.
