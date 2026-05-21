/**
 * @palamedes/extractor
 *
 * High-performance message extractor using the native Palamedes core.
 * This extractor is ~20-100x faster than the Babel-based extractor.
 *
 * It directly extracts messages from Palamedes macro syntax without
 * requiring Babel transformation first.
 */

import {
  extractMessagesNative,
  type NativeExtractedMessage,
} from "@palamedes/core-node"

const SUPPORTED_EXTENSIONS =
  /\.(js|mjs|cjs|jsx|ts|mts|cts|tsx)$/i

export type ExtractedMessageInfo = NativeExtractedMessage

/**
 * Extract source-first messages from a JavaScript or TypeScript module.
 */
export function extractMessages(
  source: string,
  filename: string
): ExtractedMessageInfo[] {
  return extractMessagesNative(source, filename)
}

/**
 * Native extractor for Palamedes-compatible message syntax.
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
    onMessageExtracted: (msg: ExtractedMessageInfo) => void
  ): Promise<void>
}

export const extractor: PalamedesExtractor = {
  match(filename: string): boolean {
    return SUPPORTED_EXTENSIONS.test(filename)
  },

  async extract(
    filename: string,
    code: string,
    onMessageExtracted: (msg: ExtractedMessageInfo) => void
  ): Promise<void> {
    for (const msg of extractMessages(code, filename)) {
      onMessageExtracted(msg)
    }
  },
}

export default extractor
