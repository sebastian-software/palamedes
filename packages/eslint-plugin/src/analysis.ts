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
  failure?: NativeFailure
}

export type NativeFailure = {
  message: string
  location?: NativeFailureLocation
}

/** A one-based native source location, before conversion to a host location. */
export type NativeFailureLocation = {
  line: number
  column: number
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
  // Deliberately separate from the analysis cache: a new SourceCode instance is
  // a new host parse, even when it can reuse a cached native result.
  const reportedFailures = new WeakSet<SourceCodeLike>()
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
        failure: nativeFailureFromError(error),
      }
    }
    bySourceCode.set(context.sourceCode, cached)
    byFilename.set(context.filename, cached)
    return cached
  }

  /**
   * Return a fatal native failure only to the first facade for this SourceCode.
   * WeakSet ownership makes this atomic with respect to interleaved rule visits
   * without retaining host parse objects between editor runs.
   */
  function takeUnreportedFailure(context: AnalysisContext): NativeFailure | undefined {
    const result = analyzeContext(context)
    if (!result.failure || reportedFailures.has(context.sourceCode)) {
      return undefined
    }

    reportedFailures.add(context.sourceCode)
    return result.failure
  }

  return {
    analyzeContext,
    takeUnreportedFailure,
    nativeCallCount: () => nativeCalls,
  }
}

function nativeFailureFromError(error: unknown): NativeFailure {
  const message = error instanceof Error ? error.message : String(error)
  return {
    message,
    location: parseNativeFailureLocation(message),
  }
}

/**
 * Native authoring errors deliberately format a source location after either
 * `at ` or `Location: `. Restrict parsing to those templates so an arbitrary
 * colon in an explanatory or multi-line message cannot become a false location.
 */
export function parseNativeFailureLocation(message: string): NativeFailureLocation | undefined {
  const match = /(?:\bat |\bLocation: )(.+):(\d+):(\d+)(?=[:.\n]|$)/.exec(message)
  if (!match) {
    return undefined
  }

  const line = Number(match[2])
  const column = Number(match[3])
  return Number.isSafeInteger(line) && line >= 1 && Number.isSafeInteger(column) && column >= 1
    ? { line, column }
    : undefined
}

/**
 * Convert Palamedes' one-based Unicode-scalar coordinates to the UTF-16 index
 * consumed by ESLint and Oxlint. Invalid or out-of-range locations are not
 * trustworthy and intentionally fall back to the start of the file.
 */
export function nativeFailureLocationToUtf16Index(
  source: string,
  location: NativeFailureLocation
): number | undefined {
  if (location.line < 1 || location.column < 1) {
    return undefined
  }

  const lines = source.split("\n")
  const line = lines[location.line - 1]
  if (line === undefined) {
    return undefined
  }

  const characters = [...line]
  if (location.column > characters.length + 1) {
    return undefined
  }

  let index = 0
  for (let lineIndex = 0; lineIndex < location.line - 1; lineIndex += 1) {
    index += lines[lineIndex].length + 1
  }
  return index + characters.slice(0, location.column - 1).join("").length
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
