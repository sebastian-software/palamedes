import {
  formatMessageNodes,
  formatMessagePattern,
  parseMessagePattern,
  type MessageNode,
} from "./messageFormat"

export type MessageMetadata = {
  message?: string
  context?: string
  comment?: string
  /**
   * Suppress `onMissing` for this lookup. Used by the runtime choice
   * components, whose synthesized source patterns are expected to miss the
   * catalog in apps that never loaded matching entries.
   */
  reportMissing?: boolean
}

export type CatalogMessages = Record<string, string>

/**
 * Build-time parser output associated with a generated string catalog.
 *
 * A missing key marks constant text; `false` keeps runtime parsing for a
 * compiler-rejected message. Catalogs without this attached metadata remain
 * entirely lazy-parsed.
 */
export type PrecompiledCatalogMessages = Record<string, MessageNode[] | false>

const PRECOMPILED_MESSAGES_SYMBOL = Symbol.for("@palamedes/core/precompiled-messages")

/**
 * Associates build-time parser output with a catalog without changing its
 * public `Record<string, string>` shape or JSON/spread behavior.
 *
 * Catalog loaders emit this helper call. Application code normally only needs
 * to pass the returned messages to `i18n.load()`.
 */
export function defineCompiledCatalog(
  messages: CatalogMessages,
  precompiled: PrecompiledCatalogMessages
): CatalogMessages {
  Object.defineProperty(messages, PRECOMPILED_MESSAGES_SYMBOL, {
    configurable: false,
    enumerable: false,
    value: precompiled,
    writable: false,
  })
  return messages
}

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

/**
 * A rendering failure raised outside core, reported back through the instance.
 *
 * The active locale is filled in by the instance and non-`Error` throws are
 * normalized, so callers only supply what they know.
 */
export type ReportedMessageError = {
  id?: string
  error: unknown
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
  /**
   * Route a rendering failure raised outside core through this instance's
   * `onError` hook. The host adapters (React/Solid) render message nodes
   * themselves, so their failures would otherwise bypass the telemetry that
   * `_()` reports for the very same message.
   */
  reportError: (info: ReportedMessageError) => void
}

type ResolvedMessage = {
  pattern: string
  fallback: string
  precompiled?: MessageNode[] | null
}

type LoadedCatalog = {
  messages: CatalogMessages
  precompiled: Record<string, MessageNode[] | null>
}

export function createI18n(options: CreateI18nOptions = {}): PalamedesI18n {
  const catalogs = new Map<string, LoadedCatalog>()
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
    const catalogMessage = catalog?.messages[id]
    const fallback = metadata?.message ?? id

    if (catalogMessage !== undefined) {
      return {
        pattern: catalogMessage,
        fallback,
        precompiled:
          catalog !== undefined && Object.hasOwn(catalog.precompiled, id)
            ? catalog.precompiled[id]
            : undefined,
      }
    }

    if (metadata?.reportMissing !== false) {
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
      if (message.precompiled === null) {
        return message.pattern
      }
      if (message.precompiled !== undefined) {
        return formatMessageNodes(message.precompiled, values, activeLocale)
      }
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
      if (message.precompiled === null) {
        return message.pattern.length === 0 ? [] : [{ type: "text", value: message.pattern }]
      }
      if (message.precompiled !== undefined) {
        return message.precompiled
      }
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
      const current = catalogs.get(locale) ?? {
        messages: Object.create(null) as CatalogMessages,
        precompiled: Object.create(null) as Record<string, MessageNode[] | null>,
      }
      const precompiled = getPrecompiledCatalogMessages(messages)

      for (const [id, pattern] of Object.entries(messages)) {
        current.messages[id] = pattern
        if (precompiled === undefined) {
          delete current.precompiled[id]
        } else if (Object.hasOwn(precompiled, id)) {
          const nodes = precompiled[id]
          if (Array.isArray(nodes)) {
            current.precompiled[id] = nodes
          } else {
            delete current.precompiled[id]
          }
        } else {
          current.precompiled[id] = null
        }
      }

      catalogs.set(locale, current)
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

    reportError(info) {
      notifyError({
        id: info.id,
        locale: activeLocale,
        error: normalizeError(info.error),
        pattern: info.pattern,
        fallback: info.fallback,
        metadata: info.metadata,
      })
    },

    _(id, values = {}, metadata) {
      return renderMessage(resolveMessage(id, metadata), values, id, metadata)
    },
  }
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function getPrecompiledCatalogMessages(
  messages: CatalogMessages
): PrecompiledCatalogMessages | undefined {
  return (messages as CatalogMessages & Record<symbol, PrecompiledCatalogMessages | undefined>)[
    PRECOMPILED_MESSAGES_SYMBOL
  ]
}

export { formatMessageNodes, formatMessagePattern, parseMessagePattern }
export {
  replacePoundPlaceholders,
  resolveChoice,
  stringifyValue,
  type ResolvedChoice,
} from "./messageFormat"
export type {
  MessageNode,
  MessageChoiceNode,
  MessageFormattedArgumentNode,
  MessageLiteralNode,
  MessageTagNode,
  MessageTextNode,
  MessageVariableNode,
} from "./messageFormat"
