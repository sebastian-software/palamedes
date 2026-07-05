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

`findMacroImports()` expects a parsed AST program, not a source string. Use
`mightContainPalamedesMacros(source)` as the cheap string pre-check before
parsing.

Most apps should use a framework plugin instead of this package directly.
