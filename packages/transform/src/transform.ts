import { transformMacrosNative, type NativeTransformResult } from "@palamedes/core-node"

import type { SourceMap, TransformOptions, TransformResult } from "./types"
import { mightContainPalamedesMacros } from "./detect"

function buildTransformOutput(
  filename: string,
  nativeResult: NativeTransformResult
): TransformResult {
  return {
    code: nativeResult.code,
    hasChanged: true,
    compiledIds: nativeResult.compiledIds,
    map: toTransformSourceMap(nativeResult.map, filename),
  }
}

function toTransformSourceMap(
  map: NativeTransformResult["map"],
  filename: string
): SourceMap | null {
  if (!map) {
    return null
  }

  return {
    version: map.version,
    sources: map.sources,
    sourcesContent: map.sourcesContent,
    names: map.names,
    mappings: map.mappings,
    file: map.file ?? filename,
  }
}

export function transformPalamedesMacros(
  code: string,
  filename: string,
  options: TransformOptions = {}
): TransformResult {
  if (!mightContainPalamedesMacros(code)) {
    return { code, hasChanged: false, compiledIds: [], map: null }
  }

  const result = transformMacrosNative(code, filename, options)
  if (!result.hasChanged) {
    return { code, hasChanged: false, compiledIds: [], map: null }
  }

  return buildTransformOutput(filename, result)
}
