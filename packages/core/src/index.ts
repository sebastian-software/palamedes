import { formatMessagePattern, parseMessagePattern } from "./messageFormat"

export type MessageMetadata = {
  message?: string
  context?: string
  comment?: string
}

export type CatalogMessages = Record<string, string>

export type MissingMessageInfo = {
  id: string
  locale: string
  metadata?: MessageMetadata
}

export type MessageFormatErrorInfo = {
  id?: string
  locale?: string
  error: Error
  pattern: string
  fallback: string
  metadata?: MessageMetadata
}

export type CreateI18nOptions = {
  onMissing?: (info: MissingMessageInfo) => void
  onError?: (info: MessageFormatErrorInfo) => void
}

export type PalamedesI18n = {
  locale?: string
  _: (id: string, values?: Record<string, unknown>, metadata?: MessageMetadata) => string
  load: (locale: string, messages: CatalogMessages) => void
  activate: (locale: string) => void
  getMessage: (id: string, metadata?: MessageMetadata) => string
}

type ResolvedMessage = {
  pattern: string
  fallback: string
}

export function createI18n(options: CreateI18nOptions = {}): PalamedesI18n {
  const catalogs = new Map<string, CatalogMessages>()
  let activeLocale: string | undefined

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
    const catalog = activeLocale ? catalogs.get(activeLocale) : undefined
    const catalogMessage = catalog?.[id]
    const fallback = metadata?.message ?? id

    if (catalogMessage !== undefined) {
      return {
        pattern: catalogMessage,
        fallback,
      }
    }

    if (activeLocale) {
      notifyMissing({
        id,
        locale: activeLocale,
        metadata,
      })
    }

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
  MessageVariableNode,
} from "./messageFormat"
