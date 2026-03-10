import { transformMacrosNative } from "@palamedes/core-node"

import type { TransformOptions, TransformResult } from "./types"
import { mightContainLinguiMacros } from "./detect"
import { transformLinguiMacrosJs } from "./transformJs"

function shouldUseJsFallback(code: string, options: TransformOptions): boolean {
  void code
  if (options.sourceMap !== false) {
    return true
  }
  return false
}

export function transformLinguiMacros(
  code: string,
  filename: string,
  options: TransformOptions = {}
): TransformResult {
  if (!mightContainLinguiMacros(code)) {
    return { code, hasChanged: false, map: null }
  }

  if (shouldUseJsFallback(code, options)) {
    return transformLinguiMacrosJs(code, filename, options)
  }

  try {
    const result = transformMacrosNative(code, filename, options)
    return {
      code: result.code,
      hasChanged: result.hasChanged,
      map: null,
    }
  } catch {
    return transformLinguiMacrosJs(code, filename, options)
  }
}

export { transformLinguiMacrosJs }
