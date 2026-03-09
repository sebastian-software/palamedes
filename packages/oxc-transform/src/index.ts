/**
 * @lingui/oxc-transform
 *
 * OXC-based macro transformer for Lingui.
 * Transforms Lingui macros to runtime calls without Babel.
 */

export { transformLinguiMacros } from "./transform"
export type { TransformOptions, TransformResult, SourceMap } from "./types"
export { LINGUI_MACRO_PACKAGES, JS_MACROS, JSX_MACROS } from "./types"
export { mightContainLinguiMacros, findMacroImports } from "./detect"
