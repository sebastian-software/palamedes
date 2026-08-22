import {
  compiledMessageSource,
  createStringMessageRuntime,
  isCompiledCatalog,
  type CatalogMessage,
  type CatalogMessages,
  type CompiledCatalogMessages,
  type CompiledMessageRuntime,
  type MessageValues,
  type PatternFormatter,
} from "./compiledMessage"
import type { MessageNode } from "./messageFormat"

export type MessageMetadata = {
  message?: string
  context?: string
  comment?: string
  /** Suppress `onMissing` for a lookup whose source fallback is expected to miss. */
  reportMissing?: boolean
  /** The host renderer can parse an uncompiled ICU source fallback. */
  renderUncompiledPattern?: boolean
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

export type ReportedMessageError = {
  id?: string
  error: unknown
  pattern: string
  fallback: string
  metadata?: MessageMetadata
}

export type CreateI18nOptions = {
  locale?: string
  /**
   * IANA time zone used for ICU `{value, date}` and `{value, time}` arguments.
   * Set this to the same value while rendering on the server and client to
   * avoid hydration differences caused by their ambient host time zones.
   */
  timeZone?: string
  onMissing?: (info: MissingMessageInfo) => void
  onError?: (info: MessageFormatErrorInfo) => void
}

export type PalamedesI18n = {
  readonly locale: string
  /** The optional IANA time zone configured when this instance was created. */
  readonly timeZone?: string
  _: (id: string, values?: MessageValues, metadata?: MessageMetadata) => string
  load: (locale: string, messages: CatalogMessages | CompiledCatalogMessages) => void
  activate: (locale: string) => void
  getMessage: (id: string, metadata?: MessageMetadata) => string
  getMessageNodes: (id: string, metadata?: MessageMetadata) => MessageNode[]
  /** Parse a raw ICU pattern without performing a catalog lookup when supported. */
  parsePattern?: (pattern: string) => MessageNode[]
  /** Execute a message directly against a host renderer such as React or Solid. */
  renderMessage?: <TResult>(
    id: string,
    values: MessageValues,
    runtime: CompiledMessageRuntime<TResult>,
    metadata?: MessageMetadata
  ) => TResult
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

export type I18nPatternSupport = {
  formatPattern: PatternFormatter
  parsePattern: (pattern: string) => MessageNode[]
}

/** Shared instance state machine used by the full and parser-free entries. */
export function createI18nRuntime(
  options: CreateI18nOptions = {},
  patternSupport?: I18nPatternSupport
): PalamedesI18n {
  const catalogs = new Map<string, LoadedCatalog>()
  const stringRuntimes = new Map<string, CompiledMessageRuntime<string>>()
  let activeLocale = options.locale ?? DEFAULT_LOCALE
  const timeZone = validateTimeZone(options.timeZone)

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
      notifyMissing({ id, locale: activeLocale, metadata })
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
      if (
        message.compiled ||
        (patternSupport === undefined && !metadata?.renderUncompiledPattern)
      ) {
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
          return patternSupport === undefined
            ? runtime.join(message.fallback)
            : runtime.pattern(message.fallback, values)
        } catch {
          // Fall through to plain source text when the fallback is malformed.
        }
      }

      return runtime.join(message.fallback)
    }
  }

  function getStringRuntime(locale: string): CompiledMessageRuntime<string> {
    const cacheKey = `${locale}\0${timeZone ?? ""}`
    const cached = stringRuntimes.get(cacheKey)
    if (cached) {
      return cached
    }
    const runtime = createStringMessageRuntime(
      locale,
      patternSupport?.formatPattern ?? noParser,
      timeZone
    )
    stringRuntimes.set(cacheKey, runtime)
    return runtime
  }

  function parseResolvedMessage(
    message: ResolvedMessage,
    id?: string,
    metadata?: MessageMetadata
  ): MessageNode[] {
    if (patternSupport === undefined) {
      throw new Error(
        "getMessageNodes() requires the compatibility runtime from @palamedes/core; the parser-free @palamedes/core/compiled entry renders generated messages directly."
      )
    }

    const pattern = getResolvedPattern(message)
    try {
      return patternSupport.parsePattern(pattern)
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
        return patternSupport.parsePattern(message.fallback)
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

    get timeZone() {
      return timeZone
    },

    load(locale, messages) {
      if (patternSupport === undefined && !isCompiledCatalog(messages)) {
        throw new TypeError(
          "The parser-free runtime only accepts generated CompiledCatalogMessages. Import createI18n from @palamedes/core for hand-written string catalogs."
        )
      }

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

function noParser(pattern: string): never {
  throw new Error(
    `The generated message requires the compatibility ICU parser: ${JSON.stringify(pattern)}`
  )
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function validateTimeZone(timeZone: string | undefined): string | undefined {
  if (timeZone === undefined) {
    return undefined
  }

  if (typeof timeZone !== "string" || timeZone.trim().length === 0) {
    throw new RangeError("timeZone must be a non-empty IANA time-zone identifier.")
  }

  try {
    Intl.DateTimeFormat("en", { timeZone }).resolvedOptions()
  } catch {
    throw new RangeError(`Invalid IANA time zone: ${JSON.stringify(timeZone)}.`)
  }

  return timeZone
}
