import { fileURLToPath } from "node:url"
import type { registerHooks } from "node:module"

import { transformPalamedesMacros, type SourceMap } from "@palamedes/transform"

export type PalamedesRemixRegisterOptions = {
  /**
   * Files eligible for macro transformation.
   * @default /\.(tsx?|jsx?|mjs|cjs)$/
   */
  include?: RegExp

  /**
   * Files excluded from macro transformation.
   * @default /[/\\]node_modules[/\\]/
   */
  exclude?: RegExp

  /**
   * Module imported for the runtime i18n getter.
   * @default "@palamedes/runtime"
   */
  runtimeModule?: string
}

type RegisterHooksOptions = Parameters<typeof registerHooks>[0]

export type LoadHook = NonNullable<RegisterHooksOptions["load"]>
export type LoadResult = ReturnType<LoadHook>

const DEFAULT_INCLUDE = /\.(tsx?|jsx?|mjs|cjs)$/
const DEFAULT_EXCLUDE = /[/\\]node_modules[/\\]/
const INLINE_SOURCE_MAP_COMMENT =
  /(?:\r?\n)?\/\/# sourceMappingURL=data:application\/json[^,\r\n]*;base64,[^\r\n]+(?:\r?\n)?$/u

export function createPalamedesRemixLoadHook(
  options: PalamedesRemixRegisterOptions = {}
): LoadHook {
  const include = options.include ?? DEFAULT_INCLUDE
  const exclude = options.exclude ?? DEFAULT_EXCLUDE
  const runtimeModule = options.runtimeModule ?? "@palamedes/runtime"

  return (url, context, nextLoad) => {
    const loaded = nextLoad(url, context)
    if (!shouldTransformUrl(url, include, exclude) || loaded.source == null) {
      return loaded
    }

    const code = stringifySource(loaded.source)
    const result = transformPalamedesMacros(code, fileURLToPath(url), {
      runtimeModule,
    })

    if (!result.hasChanged) {
      return loaded
    }

    return {
      ...loaded,
      source: appendInlineSourceMap(stripInlineSourceMap(result.code), result.map),
    }
  }
}

function shouldTransformUrl(url: string, include: RegExp, exclude: RegExp): boolean {
  if (!url.startsWith("file:")) {
    return false
  }

  const filePath = fileURLToPath(url)
  return include.test(filePath) && !exclude.test(filePath)
}

function stringifySource(source: NonNullable<LoadResult["source"]>): string {
  if (typeof source === "string") {
    return source
  }

  if (source instanceof ArrayBuffer) {
    return Buffer.from(source).toString("utf8")
  }

  return Buffer.from(source.buffer, source.byteOffset, source.byteLength).toString("utf8")
}

function stripInlineSourceMap(code: string): string {
  return code.replace(INLINE_SOURCE_MAP_COMMENT, "")
}

function appendInlineSourceMap(code: string, map: SourceMap | null): string {
  if (!map) {
    return code
  }

  const encoded = Buffer.from(JSON.stringify(map), "utf8").toString("base64")
  return `${code}\n//# sourceMappingURL=data:application/json;base64,${encoded}`
}
