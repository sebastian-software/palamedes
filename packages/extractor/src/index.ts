/**
 * @palamedes/extractor
 *
 * High-performance message extractor using the native Palamedes core.
 * This extractor is ~20-100x faster than the Babel-based extractor.
 *
 * It directly extracts messages from Palamedes macro syntax without
 * requiring Babel transformation first.
 */

import { parseSync } from "oxc-parser"
import { extractMessagesNative } from "@palamedes/core-node"

import type { ExtractedMessageInfo } from "./extractMessages"
import { extractMessagesJs } from "./extractMessagesJs"

const SUPPORTED_EXTENSIONS =
  /\.(js|mjs|cjs|jsx|ts|mts|cts|tsx)$/i

/**
 * Native-first extractor for Palamedes-compatible message syntax.
 *
 * Supports:
 * - JSX: <Trans>, <Plural>, <Select>, <SelectOrdinal>
 * - JS: t`...`, t({...}), plural(), select(), selectOrdinal(), msg`...`, defineMessage()
 *
 * @example
 * ```ts
 * import { extractor } from "@palamedes/extractor"
 *
 * if (extractor.match("app.tsx")) {
 *   await extractor.extract("app.tsx", source, (message) => {
 *     console.log(message)
 *   })
 * }
 * ```
 */
export interface PalamedesExtractor {
  match(filename: string): boolean
  extract(
    filename: string,
    code: string,
    onMessageExtracted: (msg: import("./extractMessages").ExtractedMessageInfo) => void
  ): Promise<void>
}

export const extractor: PalamedesExtractor = {
  match(filename: string): boolean {
    return SUPPORTED_EXTENSIONS.test(filename)
  },

  async extract(
    filename: string,
    code: string,
    onMessageExtracted: (msg: import("./extractMessages").ExtractedMessageInfo) => void
  ): Promise<void> {
    let messages: ExtractedMessageInfo[]

    try {
      messages = extractMessagesNative(code, filename)
    } catch (error) {
      if (isFatalNativeExtractionError(error)) {
        throw error
      }

      messages = extractMessagesWithJsFallback(filename, code)
    }

    for (const msg of messages) {
      onMessageExtracted(msg)
    }
  },
}

function extractMessagesWithJsFallback(
  filename: string,
  code: string
): ExtractedMessageInfo[] {
  const result = parseSync(filename, code, {
    sourceType: "module",
  })

  if (result.errors.length > 0) {
    // Throw on parse errors so the CLI can handle them appropriately
    const errorMessages = result.errors.map((e) => e.message).join(", ")
    throw new Error(`Parse error: ${errorMessages}`)
  }

  return extractMessagesJs(result.program, filename, code)
}

function isFatalNativeExtractionError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("Explicit message ids are no longer supported")
  )
}

export default extractor
export { extractMessages } from "./extractMessages"
export { extractMessagesJs } from "./extractMessagesJs"
export type { ExtractedMessageInfo } from "./extractMessages"
