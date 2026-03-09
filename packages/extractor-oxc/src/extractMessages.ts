import type { ExtractedMessage } from "@lingui/conf"
import {
  extractMessagesNative,
  type NativeExtractedMessage,
} from "@palamedes/core-node"

import { extractMessagesJs } from "./extractMessagesJs"

export interface ExtractedMessageInfo extends ExtractedMessage {
  origin: [filename: string, line: number, column?: number]
}

const NATIVE_FALLBACK_PATTERNS = [
  /<\s*(Trans|Plural|Select|SelectOrdinal)\b/,
  /\b(plural|select|selectOrdinal)\s*\(/,
]

function shouldUseJsFallback(code?: string): boolean {
  if (!code) {
    return true
  }

  return NATIVE_FALLBACK_PATTERNS.some((pattern) => pattern.test(code))
}

function normalizeNativeMessages(
  messages: NativeExtractedMessage[]
): ExtractedMessageInfo[] {
  return messages.map((message) => ({
    ...message,
  }))
}

export function extractMessages(
  program: unknown,
  filename: string,
  code?: string
): ExtractedMessageInfo[] {
  if (shouldUseJsFallback(code)) {
    return extractMessagesJs(program, filename, code)
  }

  try {
    return normalizeNativeMessages(
      extractMessagesNative(code ?? "", filename)
    )
  } catch {
    return extractMessagesJs(program, filename, code)
  }
}

export { extractMessagesJs }
