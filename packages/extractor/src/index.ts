/**
 * @palamedes/extractor
 *
 * High-performance message extractor using oxc-parser.
 * This extractor is ~20-100x faster than the Babel-based extractor.
 *
 * It directly extracts messages from Lingui macro syntax without
 * requiring Babel transformation first.
 */

import { parseSync } from "oxc-parser"
import type { ExtractorType, ExtractedMessage, ExtractorCtx } from "@lingui/conf"

import { extractMessages } from "./extractMessages"

const SUPPORTED_EXTENSIONS =
  /\.(js|mjs|cjs|jsx|ts|mts|cts|tsx)$/i

/**
 * oxc-based extractor for Lingui messages.
 *
 * Supports:
 * - JSX: <Trans>, <Plural>, <Select>, <SelectOrdinal>
 * - JS: t`...`, t({...}), plural(), select(), selectOrdinal(), msg`...`, defineMessage()
 *
 * @example
 * ```ts
 * // lingui.config.ts
 * import { extractor } from '@palamedes/extractor'
 *
 * export default {
 *   extractors: [extractor],
 *   // ...
 * }
 * ```
 */
export const extractor: ExtractorType = {
  match(filename: string): boolean {
    return SUPPORTED_EXTENSIONS.test(filename)
  },

  async extract(
    filename: string,
    code: string,
    onMessageExtracted: (msg: ExtractedMessage) => void,
    ctx: ExtractorCtx
  ): Promise<void> {
    const result = parseSync(filename, code, {
      sourceType: "module",
    })

    if (result.errors.length > 0) {
      // Throw on parse errors so the CLI can handle them appropriately
      const errorMessages = result.errors.map((e) => e.message).join(", ")
      throw new Error(`Parse error: ${errorMessages}`)
    }

    const messages = extractMessages(result.program, filename, code)

    for (const msg of messages) {
      onMessageExtracted(msg)
    }
  },
}

export default extractor
export { extractMessages } from "./extractMessages"
export { extractMessagesJs } from "./extractMessages"
export type { ExtractedMessageInfo } from "./extractMessages"
