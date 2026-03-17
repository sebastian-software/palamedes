import {
  extractMessagesNative,
  type NativeExtractedMessage,
} from "@palamedes/core-node"

import { extractMessagesJs } from "./extractMessagesJs"

export interface ExtractedMessageInfo {
  message: string
  comment?: string
  context?: string
  placeholders?: Record<string, string>
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
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("Explicit message ids are no longer supported")
    ) {
      throw error
    }
    return extractMessagesJs(program, filename, code)
  }
}

export { extractMessagesJs }
