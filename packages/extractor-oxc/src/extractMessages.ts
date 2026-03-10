import type { ExtractedMessage } from "@lingui/conf"
import {
  extractMessagesNative,
  type NativeExtractedMessage,
} from "@palamedes/core-node"

import { extractMessagesJs } from "./extractMessagesJs"

export interface ExtractedMessageInfo extends ExtractedMessage {
  origin: [filename: string, line: number, column?: number]
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
  if (!code) {
    return extractMessagesJs(program, filename, code)
  }

  try {
    return normalizeNativeMessages(extractMessagesNative(code, filename))
  } catch {
    return extractMessagesJs(program, filename, code)
  }
}

export { extractMessagesJs }
