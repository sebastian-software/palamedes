/**
 * @palamedes/transform
 *
 * Native macro transformer for Palamedes.
 * Transforms Palamedes macros to runtime calls without Babel.
 */

export { transformPalamedesMacros } from "./transform"
export type { TransformOptions, TransformResult, SourceMap } from "./types"
export { PALAMEDES_MACRO_PACKAGES, JS_MACROS, JSX_MACROS } from "./types"
export { mightContainPalamedesMacros, findMacroImports } from "./detect"
export {
  createCatalogLoaderResult,
  createCompileErrorMessage,
  createDiagnosticMessage,
  createMissingErrorMessage,
  renderCatalogModule,
} from "./catalogLoader"
export type {
  CatalogCompileArtifactResult,
  CatalogDiagnostic,
  CatalogLoaderOptions,
  CatalogLoaderResult,
  CatalogSourceKey,
  MissingCatalogMessage,
} from "./catalogLoader"
