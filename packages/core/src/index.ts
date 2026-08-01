import {
  compiledMessageSource,
  createStringMessageRuntime,
  isCompiledCatalog,
  type CatalogMessage,
  type CatalogMessages,
  type CompiledCatalogMessages,
  type CompiledMessageRuntime,
  type MessageValues,
} from "./compiledMessage"
import {
  formatMessageArgument,
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
  _: (id: string, values?: MessageValues, metadata?: MessageMetadata) => string
  load: (locale: string, messages: CatalogMessages | CompiledCatalogMessages) => void
  activate: (locale: string) => void
  getMessage: (id: string, metadata?: MessageMetadata) => string
  getMessageNodes: (id: string, metadata?: MessageMetadata) => MessageNode[]
  /** Execute a message directly against a host renderer such as React or Solid. */
  renderMessage: <TResult>(
    id: string,
    values: MessageValues,
    runtime: CompiledMessageRuntime<TResult>,
    metadata?: MessageMetadata
  ) => TResult
  /**
   * Route a rendering failure raised outside core through this instance's
   * `onError` hook. Kept for custom and older host adapters; first-party
   * adapters use `renderMessage()`, which reports failures itself.
   */
  reportError: (info: ReportedMessageError) => void
}

type ResolvedMessage = {
  value: CatalogMessage
  fallback: string
  compiled: boolean
  fromCatalog: boolean
}

type LoadedMessage = {
  value: CatalogMessage
  compiled: boolean
}

type LoadedCatalog = Record<string, LoadedMessage>

export function createI18n(options: CreateI18nOptions = {}): PalamedesI18n {
  const catalogs = new Map<string, LoadedCatalog>()
  const stringRuntimes = new Map<string, CompiledMessageRuntime<string>>()
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
    const loaded = catalog !== undefined && Object.hasOwn(catalog, id) ? catalog[id] : undefined
    const fallback = metadata?.message ?? id

    if (loaded !== undefined) {
      return {
        value: loaded.value,
        fallback,
        compiled: loaded.compiled,
        fromCatalog: true,
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
      value: fallback,
      fallback,
      compiled: false,
      fromCatalog: false,
    }
  }

  function renderResolvedMessage<TResult>(
    message: ResolvedMessage,
    values: MessageValues,
    runtime: CompiledMessageRuntime<TResult>,
    id?: string,
    metadata?: MessageMetadata
  ): TResult {
    try {
      if (typeof message.value === "function") {
        return message.value<TResult>(values, runtime)
      }
      if (message.compiled) {
        return runtime.join(message.value)
      }
      return runtime.pattern(message.value, values)
    } catch (error) {
      const pattern = getResolvedPattern(message)
      notifyError({
        id,
        locale: activeLocale,
        error: normalizeError(error),
        pattern,
        fallback: message.fallback,
        metadata,
      })

      if (message.fromCatalog && pattern !== message.fallback) {
        try {
          return runtime.pattern(message.fallback, values)
        } catch {
          // Fall through to plain source text when the fallback is malformed.
        }
      }

      return runtime.join(message.fallback)
    }
  }

  function getStringRuntime(locale: string): CompiledMessageRuntime<string> {
    const cached = stringRuntimes.get(locale)
    if (cached) {
      return cached
    }
    const runtime = createStringMessageRuntime(locale)
    stringRuntimes.set(locale, runtime)
    return runtime
  }

  function parseResolvedMessage(
    message: ResolvedMessage,
    id?: string,
    metadata?: MessageMetadata
  ): MessageNode[] {
    const pattern = getResolvedPattern(message)
    try {
      return parseMessagePattern(pattern)
    } catch (error) {
      notifyError({
        id,
        locale: activeLocale,
        error: normalizeError(error),
        pattern,
        fallback: message.fallback,
        metadata,
      })
    }

    if (message.fromCatalog && pattern !== message.fallback) {
      try {
        return parseMessagePattern(message.fallback)
      } catch {
        // Fall through to plain source text when the fallback is malformed.
      }
    }

    return [{ type: "text", value: message.fallback }]
  }

  return {
    get locale() {
      return activeLocale
    },

    load(locale, messages) {
      const current = catalogs.get(locale) ?? (Object.create(null) as LoadedCatalog)
      const compiledCatalog = isCompiledCatalog(messages)

      for (const [id, value] of Object.entries(messages)) {
        current[id] = {
          value,
          compiled: compiledCatalog || typeof value === "function",
        }
      }

      catalogs.set(locale, current)
    },

    activate(locale) {
      activeLocale = locale
    },

    getMessage(id, metadata) {
      return getResolvedPattern(resolveMessage(id, metadata))
    },

    getMessageNodes(id, metadata) {
      return parseResolvedMessage(resolveMessage(id, metadata), id, metadata)
    },

    renderMessage(id, values, runtime, metadata) {
      return renderResolvedMessage(resolveMessage(id, metadata), values, runtime, id, metadata)
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
      return renderResolvedMessage(
        resolveMessage(id, metadata),
        values,
        getStringRuntime(activeLocale),
        id,
        metadata
      )
    },
  }
}

function getResolvedPattern(message: ResolvedMessage): string {
  if (typeof message.value === "string") {
    return message.value
  }
  try {
    return compiledMessageSource(message.value)
  } catch {
    return message.fallback
  }
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export {
  createCompiledMessageRuntime,
  defineCompiledCatalog,
  type CatalogMessage,
  type CatalogMessages,
  type CompiledCatalogMessages,
  type CompiledMessage,
  type CompiledMessageBranch,
  type CompiledMessageBranches,
  type CompiledMessageRuntime,
  type ExecutableMessageRenderer,
  type MessageValues,
} from "./compiledMessage"
export { formatMessageArgument, formatMessagePattern, parseMessagePattern }
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
