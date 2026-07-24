import { formatMessagePattern, parseMessagePattern, type MessageNode } from "./messageFormat"

export type MessageMetadata = {
  message?: string
  context?: string
  comment?: string
}

export type CatalogMessages = Record<string, string>

export const DEFAULT_LOCALE = "en"

export type MissingMessageInfo = {
  id: string
  locale: string
  metadata?: MessageMetadata
}

export type MessageFormatErrorInfo = {
  id?: string
  locale: string
  error: Error
  pattern: string
  fallback: string
  metadata?: MessageMetadata
}

export type CreateI18nOptions = {
  locale?: string
  onMissing?: (info: MissingMessageInfo) => void
  onError?: (info: MessageFormatErrorInfo) => void
}

export type PalamedesI18n = {
  readonly locale: string
  _: (id: string, values?: Record<string, unknown>, metadata?: MessageMetadata) => string
  load: (locale: string, messages: CatalogMessages) => void
  activate: (locale: string) => void
  getMessage: (id: string, metadata?: MessageMetadata) => string
  getMessageNodes: (id: string, metadata?: MessageMetadata) => MessageNode[]
}

type ResolvedMessage = {
  pattern: string
  fallback: string
}

export function createI18n(options: CreateI18nOptions = {}): PalamedesI18n {
  const catalogs = new Map<string, CatalogMessages>()
  let activeLocale = options.locale ?? DEFAULT_LOCALE

  function notifyMissing(info: MissingMessageInfo): void {
    try {
      options.onMissing?.(info)
    } catch {
      // Telemetry hooks should not make message rendering fail.
    }
  }

  function notifyError(info: MessageFormatErrorInfo): void {
    try {
      options.onError?.(info)
    } catch {
      // Telemetry hooks should not make message rendering fail.
    }
  }

  function resolveMessage(id: string, metadata?: MessageMetadata): ResolvedMessage {
    const catalog = catalogs.get(activeLocale)
    const catalogMessage = catalog?.[id]
    const fallback = metadata?.message ?? id

    if (catalogMessage !== undefined) {
      return {
        pattern: catalogMessage,
        fallback,
      }
    }

    notifyMissing({
      id,
      locale: activeLocale,
      metadata,
    })

    return {
      pattern: fallback,
      fallback,
    }
  }

  function renderMessage(
    message: ResolvedMessage,
    values: Record<string, unknown>,
    id?: string,
    metadata?: MessageMetadata
  ): string {
    try {
      return formatMessagePattern(message.pattern, values, activeLocale)
    } catch (error) {
      notifyError({
        id,
        locale: activeLocale,
        error: normalizeError(error),
        pattern: message.pattern,
        fallback: message.fallback,
        metadata,
      })
    }

    // Keep rendering resilient after telemetry: try the source fallback, then
    // return the raw source message if that pattern is malformed too.
    if (message.pattern !== message.fallback) {
      try {
        return formatMessagePattern(message.fallback, values, activeLocale)
      } catch {
        return message.fallback
      }
    }

    return message.fallback
  }

  function parseMessage(
    message: ResolvedMessage,
    id?: string,
    metadata?: MessageMetadata
  ): MessageNode[] {
    try {
      return parseMessagePattern(message.pattern)
    } catch (error) {
      notifyError({
        id,
        locale: activeLocale,
        error: normalizeError(error),
        pattern: message.pattern,
        fallback: message.fallback,
        metadata,
      })
    }

    // Rich-text renderers need the same resilience as string formatting:
    // parse the source fallback, then render malformed source as plain text.
    if (message.pattern !== message.fallback) {
      try {
        return parseMessagePattern(message.fallback)
      } catch {
        return [{ type: "text", value: message.fallback }]
      }
    }

    return [{ type: "text", value: message.fallback }]
  }

  return {
    get locale() {
      return activeLocale
    },

    load(locale, messages) {
      const current = catalogs.get(locale) ?? {}
      catalogs.set(locale, { ...current, ...messages })
    },

    activate(locale) {
      activeLocale = locale
    },

    getMessage(id, metadata) {
      return resolveMessage(id, metadata).pattern
    },

    getMessageNodes(id, metadata) {
      return parseMessage(resolveMessage(id, metadata), id, metadata)
    },

    _(id, values = {}, metadata) {
      return renderMessage(resolveMessage(id, metadata), values, id, metadata)
    },
  }
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export { formatMessagePattern, parseMessagePattern }
export type {
  MessageNode,
  MessageChoiceNode,
  MessageFormattedArgumentNode,
  MessageLiteralNode,
  MessageTagNode,
  MessageTextNode,
  MessageVariableNode,
} from "./messageFormat"
