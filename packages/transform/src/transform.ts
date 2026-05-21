import MagicString from "magic-string"
import { transformMacrosNative, type NativeTransformEdit, type NativeTransformResult } from "@palamedes/core-node"

import type { SourceMap, TransformOptions, TransformResult } from "./types"
import { mightContainPalamedesMacros } from "./detect"

function buildTransformOutput(
  source: string,
  filename: string,
  nativeResult: NativeTransformResult
): TransformResult {
  const magicString = new MagicString(source)

  const edits = nativeResult.edits.map((edit) => normalizeNativeEditOffsets(source, edit))

  for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end)) {
    applyEdit(magicString, edit)
  }

  if (nativeResult.prependText) {
    magicString.prepend(nativeResult.prependText)
  }

  const code = magicString.toString()
  if (code !== nativeResult.code) {
    return {
      code: nativeResult.code,
      hasChanged: true,
      compiledIds: nativeResult.compiledIds,
      map: null,
    }
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
    compiledIds: nativeResult.compiledIds,
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

function normalizeNativeEditOffsets(source: string, edit: NativeTransformEdit): NativeTransformEdit {
  return {
    ...edit,
    start: utf8ByteOffsetToCodeUnitOffset(source, edit.start),
    end: utf8ByteOffsetToCodeUnitOffset(source, edit.end),
  }
}

function utf8ByteOffsetToCodeUnitOffset(source: string, byteOffset: number): number {
  if (byteOffset === 0) {
    return 0
  }

  let bytes = 0

  for (let codeUnitOffset = 0; codeUnitOffset < source.length; ) {
    const codePoint = source.codePointAt(codeUnitOffset)
    if (codePoint === undefined) {
      break
    }

    codeUnitOffset += codePoint > 0xffff ? 2 : 1
    bytes += utf8ByteLength(codePoint)

    if (bytes === byteOffset) {
      return codeUnitOffset
    }

    if (bytes > byteOffset) {
      break
    }
  }

  if (bytes === byteOffset) {
    return source.length
  }

  throw new Error(`Native transform returned invalid UTF-8 byte offset: ${byteOffset}`)
}

function utf8ByteLength(codePoint: number): number {
  if (codePoint <= 0x7f) {
    return 1
  }
  if (codePoint <= 0x7ff) {
    return 2
  }
  if (codePoint <= 0xffff) {
    return 3
  }
  return 4
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

  return buildTransformOutput(code, filename, result)
}
