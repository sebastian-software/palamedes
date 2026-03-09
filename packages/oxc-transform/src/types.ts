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
export interface TransformOptions {
  /**
   * Module to import the i18n runtime from.
   * @default "@lingui/core"
   */
  runtimeModule?: string

  /**
   * Name of the i18n export to import from the runtime module.
   * @default "i18n"
   */
  runtimeImportName?: string

  /**
   * Whether to strip non-essential props (comment, context) in production.
   * @default false
   */
  stripNonEssentialProps?: boolean

  /**
   * Whether to strip the message field from descriptors.
   * @default false
   */
  stripMessageField?: boolean

  /**
   * Whether to generate source maps.
   * @default true
   */
  sourceMap?: boolean
}

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
   * Source map for the transformation (if sourceMap option is true)
   */
  map?: SourceMap | null
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
  "useLingui",
  "getLingui",
] as const

/**
 * JSX macro component names
 */
export const JSX_MACROS = ["Trans", "Plural", "Select", "SelectOrdinal"] as const

export type JsMacroName = (typeof JS_MACROS)[number]
export type JsxMacroName = (typeof JSX_MACROS)[number]
