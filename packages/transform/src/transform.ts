import MagicString from "magic-string"
import {
  transformMacrosNative,
  type NativeTransformEdit,
  type NativeTransformResult,
} from "@palamedes/core-node"

import type { SourceMap, TransformOptions, TransformResult } from "./types"
import { mightContainLinguiMacros } from "./detect"

function buildTransformOutput(
  source: string,
  filename: string,
  nativeResult: NativeTransformResult
): TransformResult {
  const magicString = new MagicString(source)

  for (const edit of [...nativeResult.edits].sort((a, b) => b.start - a.start || b.end - a.end)) {
    applyEdit(magicString, edit)
  }

  if (nativeResult.prependText) {
    magicString.prepend(nativeResult.prependText)
  }

  const code = magicString.toString()
  if (code !== nativeResult.code) {
    throw new Error("Native transform edit replay diverged from native output")
  }

  const generated = magicString.generateMap({
    source: filename,
    file: filename,
    includeContent: true,
  })

  const map: SourceMap = {
    version: generated.version,
    sources: generated.sources,
    sourcesContent: generated.sourcesContent,
    names: generated.names,
    mappings: generated.mappings,
    file: generated.file,
  }

  return {
    code,
    hasChanged: true,
    map,
  }
}

function applyEdit(magicString: MagicString, edit: NativeTransformEdit): void {
  if (edit.start === edit.end) {
    magicString.appendLeft(edit.start, edit.text)
    return
  }

  magicString.overwrite(edit.start, edit.end, edit.text)
}

export function transformLinguiMacros(
  code: string,
  filename: string,
  options: TransformOptions = {}
): TransformResult {
  if (!mightContainLinguiMacros(code)) {
    return { code, hasChanged: false, map: null }
  }

  const result = transformMacrosNative(code, filename, options)
  if (!result.hasChanged) {
    return { code, hasChanged: false, map: null }
  }

  return buildTransformOutput(code, filename, result)
}
