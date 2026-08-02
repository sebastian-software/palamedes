import type { CompiledCatalogMessages as InternalCompiledCatalogMessages } from "./compiledMessage"
import { createI18nRuntime, type CreateI18nOptions, type PalamedesI18n } from "./i18nRuntime"

export type CompiledPalamedesI18n = Omit<PalamedesI18n, "load"> & {
  load: (locale: string, messages: InternalCompiledCatalogMessages) => void
}

/**
 * Creates the parser-free runtime for generated executable catalogs.
 *
 * Use the main `@palamedes/core` entry when loading hand-written ICU string
 * catalogs or calling parser compatibility APIs.
 */
export function createI18n(options: CreateI18nOptions = {}): CompiledPalamedesI18n {
  return createI18nRuntime(options) as CompiledPalamedesI18n
}

export { DEFAULT_LOCALE } from "./i18nRuntime"
export {
  createCompiledMessageRuntime,
  defineCompiledCatalog,
  type CatalogMessage,
  type CompiledCatalogMessages,
  type CompiledMessage,
  type CompiledMessageBranch,
  type CompiledMessageBranches,
  type CompiledMessageRuntime,
  type ExecutableMessageRenderer,
  type MessageValues,
} from "./compiledMessage"
export {
  formatMessageArgument,
  replacePoundPlaceholders,
  stringifyValue,
  type MessageFormat,
} from "./runtimeFormat"
export { resolveChoice, type ResolvedChoice } from "./runtimeChoice"
export type {
  CreateI18nOptions,
  MessageFormatErrorInfo,
  MessageMetadata,
  MissingMessageInfo,
  PalamedesI18n,
  ReportedMessageError,
} from "./i18nRuntime"
export type { MessageNode } from "./messageFormat"
