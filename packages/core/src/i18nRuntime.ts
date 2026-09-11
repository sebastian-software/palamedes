import {
  createStringMessageRuntime,
  isCompiledCatalog,
  type CatalogMessage,
  type CompiledCatalogMessages,
  type CompiledMessageRuntime,
  type MessageValues,
} from "./compiledMessage";

/** Authored identity retained for diagnostics, never a replacement message. */
export type MessageMetadata = {
  message?: string;
  context?: string;
  comment?: string;
};

export const DEFAULT_LOCALE = "en";

export type MissingMessageInfo = {
  id: string;
  locale: string;
  metadata?: MessageMetadata;
};

export type MessageFormatErrorInfo = MissingMessageInfo & { error: Error };

export type CreateI18nOptions = {
  locale?: string;
  /** Use the same IANA time zone on the server and client for hydration. */
  timeZone?: string;
  /** Observes a missing dependency. Rendering still throws after this hook. */
  onMissing?: (info: MissingMessageInfo) => void;
  /** Observes execution failures. Rendering still throws after this hook. */
  onError?: (info: MessageFormatErrorInfo) => void;
};

export type PalamedesI18n = {
  readonly locale: string;
  readonly timeZone?: string;
  _: (id: string, values?: MessageValues, metadata?: MessageMetadata) => string;
  load: (locale: string, messages: CompiledCatalogMessages) => void;
  activate: (locale: string) => void;
  renderMessage: <TResult>(
    id: string,
    values: MessageValues,
    runtime: CompiledMessageRuntime<TResult>,
    metadata?: MessageMetadata,
  ) => TResult;
};

/** Developer details are properties; ordinary host error UI need not display IDs. */
export class MissingCompiledMessageError extends Error {
  public readonly id: string;
  public readonly locale: string;
  public readonly metadata?: MessageMetadata;

  public constructor(info: MissingMessageInfo) {
    super(
      "A required compiled message is unavailable. Reload the application or contact its maintainer.",
    );
    this.name = "MissingCompiledMessageError";
    this.id = info.id;
    this.locale = info.locale;
    this.metadata = info.metadata;
  }
}

/** The one public runtime used by package roots and compiled aliases. */
export function createI18nRuntime(options: CreateI18nOptions = {}): PalamedesI18n {
  const catalogs = new Map<string, Record<string, CatalogMessage>>();
  let stringRuntime: CompiledMessageRuntime<string> | undefined;
  let stringRuntimeLocale: string | undefined;
  let activeLocale = options.locale ?? DEFAULT_LOCALE;
  const timeZone = validateTimeZone(options.timeZone);

  function resolveMessage(id: string, metadata?: MessageMetadata): CatalogMessage {
    const value = catalogs.get(activeLocale)?.[id];
    if (value !== undefined) return value;
    const info = { id, locale: activeLocale, metadata };
    try {
      options.onMissing?.(info);
    } catch {
      // An observer cannot replace the original catalog failure.
    }
    throw new MissingCompiledMessageError(info);
  }

  function renderResolvedMessage<TResult>(
    value: CatalogMessage,
    id: string,
    values: MessageValues,
    runtime: CompiledMessageRuntime<TResult>,
    metadata?: MessageMetadata,
  ): TResult {
    const locale = activeLocale;
    try {
      return typeof value === "function" ? value<TResult>(values, runtime) : runtime.join(value);
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      try {
        options.onError?.({ id, locale, error: normalized, metadata });
      } catch {
        // Telemetry cannot suppress or replace a rendering failure.
      }
      throw normalized;
    }
  }

  return {
    get locale() {
      return activeLocale;
    },
    get timeZone() {
      return timeZone;
    },
    load(locale, messages) {
      if (!isCompiledCatalog(messages)) {
        throw new TypeError(
          "Palamedes v2 only accepts generated CompiledCatalogMessages. Compile ICU catalogs before loading them; switching runtime import paths cannot enable parsing.",
        );
      }
      const entries = Object.entries(messages);
      for (const [id, value] of entries) {
        if (typeof value !== "string" && typeof value !== "function") {
          throw new TypeError(
            `Invalid compiled catalog entry ${JSON.stringify(id)} for locale ${JSON.stringify(locale)}.`,
          );
        }
      }
      const current =
        catalogs.get(locale) ?? (Object.create(null) as Record<string, CatalogMessage>);
      for (const [id, value] of entries) current[id] = value;
      catalogs.set(locale, current);
    },
    activate(locale) {
      activeLocale = locale;
    },
    renderMessage(id, values, runtime, metadata) {
      return renderResolvedMessage(resolveMessage(id, metadata), id, values, runtime, metadata);
    },
    _(id, values, metadata) {
      const value = resolveMessage(id, metadata);
      if (typeof value === "string") return value;
      if (stringRuntime === undefined || stringRuntimeLocale !== activeLocale) {
        stringRuntime = createStringMessageRuntime(activeLocale, timeZone);
        stringRuntimeLocale = activeLocale;
      }
      return renderResolvedMessage(value, id, values ?? {}, stringRuntime, metadata);
    },
  };
}

function validateTimeZone(timeZone: string | undefined): string | undefined {
  if (timeZone === undefined) {
    return undefined;
  }

  if (typeof timeZone !== "string" || timeZone.trim().length === 0) {
    throw new RangeError("timeZone must be a non-empty IANA time-zone identifier.");
  }

  try {
    Intl.DateTimeFormat("en", { timeZone }).resolvedOptions();
  } catch {
    throw new RangeError(`Invalid IANA time zone: ${JSON.stringify(timeZone)}.`);
  }

  return timeZone;
}
