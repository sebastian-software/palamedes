import type { NativeTransformOptions } from "@palamedes/core-node"

/**
 * Source map interface (compatible with standard source map format)
 */
export interface SourceMap {
  version: number
  sources: string[]
  sourcesContent?: (string | null)[]
  names: string[]
  mappings: string
  file?: string
}

/**
 * Configuration options for the Lingui OXC transform
 */
export type TransformOptions = NativeTransformOptions

/**
 * Result of a transform operation
 */
export interface TransformResult {
  /**
   * The transformed source code
   */
  code: string

  /**
   * Whether the code was modified
   */
  hasChanged: boolean

  /**
   * Source map for the transformation.
   */
  map: SourceMap | null
}

/**
 * Lingui macro package names that we recognize
 */
export const LINGUI_MACRO_PACKAGES = [
  "@lingui/macro",
  "@lingui/core/macro",
  "@lingui/react/macro",
] as const

/**
 * JS macro function names
 */
export const JS_MACROS = [
  "t",
  "msg",
  "defineMessage",
  "plural",
  "select",
  "selectOrdinal",
] as const

/**
 * JSX macro component names
 */
export const JSX_MACROS = ["Trans", "Plural", "Select", "SelectOrdinal"] as const

export type JsMacroName = (typeof JS_MACROS)[number]
export type JsxMacroName = (typeof JSX_MACROS)[number]
