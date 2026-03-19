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
 * Configuration options for the Palamedes OXC transform
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
   * Stable compiled runtime IDs referenced by the transformed module.
   */
  compiledIds: string[]

  /**
   * Source map for the transformation.
   */
  map: SourceMap | null
}

/**
 * Palamedes macro package names that we recognize
 */
export const PALAMEDES_MACRO_PACKAGES = [
  "@palamedes/core/macro",
  "@palamedes/react/macro",
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
