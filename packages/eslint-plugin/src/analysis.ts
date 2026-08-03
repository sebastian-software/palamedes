import { createHash } from "node:crypto"

import {
  analyzeSourceNative,
  type SourceAnalysisOptions,
  type SourceDiagnostic,
} from "@palamedes/core-node"

export type SourceCodeLike = {
  text: string
}

export type AnalysisContext = {
  filename: string
  sourceCode: SourceCodeLike
}

export type AnalyzeSource = (
  source: string,
  filename: string,
  options?: SourceAnalysisOptions
) => { diagnostics: SourceDiagnostic[] }

type CachedAnalysis = {
  fingerprint: string
  diagnostics: SourceDiagnostic[]
  failure?: string
}

const ALL_RULES: SourceAnalysisOptions = {
  rules: {
    placeholderOnly: "warning",
    emptyComponentOnly: "warning",
    preferTransInJsx: "warning",
  },
}

export function mightContainPalamedesSource(source: string): boolean {
  return source.includes("@palamedes") || source.includes("i18n")
}

export function createAnalysisCoordinator(analyze: AnalyzeSource = analyzeSourceNative) {
  const bySourceCode = new WeakMap<SourceCodeLike, CachedAnalysis>()
  const byFilename = new Map<string, CachedAnalysis>()
  let nativeCalls = 0

  function analyzeContext(context: AnalysisContext): CachedAnalysis {
    const weakHit = bySourceCode.get(context.sourceCode)
    if (weakHit) {
      return weakHit
    }

    const source = context.sourceCode.text
    const fingerprint = sourceFingerprint(source)
    const fileHit = byFilename.get(context.filename)
    if (fileHit?.fingerprint === fingerprint) {
      bySourceCode.set(context.sourceCode, fileHit)
      return fileHit
    }

    nativeCalls += 1
    let cached: CachedAnalysis
    try {
      cached = {
        fingerprint,
        diagnostics: analyze(source, context.filename, ALL_RULES).diagnostics,
      }
    } catch (error) {
      cached = {
        fingerprint,
        diagnostics: [],
        failure: error instanceof Error ? error.message : String(error),
      }
    }
    bySourceCode.set(context.sourceCode, cached)
    byFilename.set(context.filename, cached)
    return cached
  }

  return {
    analyzeContext,
    nativeCallCount: () => nativeCalls,
  }
}

function sourceFingerprint(source: string): string {
  return createHash("sha256").update(source).digest("base64url")
}

export function utf8ByteOffsetToUtf16Index(source: string, requestedOffset: number): number {
  const target = Math.max(0, requestedOffset)
  let bytes = 0
  let utf16Index = 0

  for (const character of source) {
    if (bytes >= target) {
      break
    }
    const codePoint = character.codePointAt(0) ?? 0
    bytes += utf8Length(codePoint)
    utf16Index += character.length
  }

  return Math.min(utf16Index, source.length)
}

function utf8Length(codePoint: number): number {
  if (codePoint <= 0x7f) return 1
  if (codePoint <= 0x07_ff) return 2
  if (codePoint <= 0xff_ff) return 3
  return 4
}
