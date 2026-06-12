import { formatMessagePattern, parseMessagePattern } from "./messageFormat"

export interface MessageDescriptor {
  id?: string
  message?: string
  context?: string
  comment?: string
}

export type CatalogMessages = Record<string, string>

export interface MissingMessageInfo {
  id: string
  locale: string
  descriptor?: MessageDescriptor
}

export interface MessageFormatErrorInfo {
  id?: string
  locale?: string
  error: Error
  pattern: string
  fallback: string
  descriptor?: MessageDescriptor
}

export interface CreateI18nOptions {
  onMissing?: (info: MissingMessageInfo) => void
  onError?: (info: MessageFormatErrorInfo) => void
}

export interface PalamedesI18n {
  locale?: string
  _: (
    idOrDescriptor: string | MessageDescriptor,
    values?: Record<string, unknown>,
    descriptor?: MessageDescriptor
  ) => string
  load: (locale: string, messages: CatalogMessages) => void
  activate: (locale: string) => void
  getMessage: (id: string, descriptor?: MessageDescriptor) => string
}

interface ResolvedMessage {
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

  function resolveMessage(id: string, descriptor?: MessageDescriptor): ResolvedMessage {
    const catalog = activeLocale ? catalogs.get(activeLocale) : undefined
    const catalogMessage = catalog?.[id]
    const fallback = descriptor?.message ?? id

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
        descriptor,
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
    descriptor?: MessageDescriptor
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
        descriptor,
      })
    }

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

    getMessage(id, descriptor) {
      return resolveMessage(id, descriptor).pattern
    },

    _(idOrDescriptor, values = {}, descriptor) {
      if (typeof idOrDescriptor === "string") {
        return renderMessage(resolveMessage(idOrDescriptor, descriptor), values, idOrDescriptor, descriptor)
      }

      if (idOrDescriptor.id !== undefined) {
        return renderMessage(
          resolveMessage(idOrDescriptor.id, idOrDescriptor),
          values,
          idOrDescriptor.id,
          idOrDescriptor
        )
      }

      const pattern = idOrDescriptor.message ?? ""
      return renderMessage({ pattern, fallback: pattern }, values, undefined, idOrDescriptor)
    },
  }
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export { formatMessagePattern, parseMessagePattern }
export type { MessageNode, MessageChoiceNode, MessageTagNode, MessageVariableNode } from "./messageFormat"
