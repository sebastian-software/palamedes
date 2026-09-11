import { createI18nRuntime, type CreateI18nOptions, type PalamedesI18n } from "./i18nRuntime";

export type CompiledPalamedesI18n = PalamedesI18n;

/** Creates the compiled-only application runtime. */
export function createI18n(options: CreateI18nOptions = {}): PalamedesI18n {
  return createI18nRuntime(options);
}

export { DEFAULT_LOCALE, MissingCompiledMessageError } from "./i18nRuntime";
export {
  createCompiledMessageRuntime,
  defineCompiledCatalog,
  isCompiledCatalog,
  type CatalogMessage,
  type CatalogMessages,
  type CompiledCatalogMessages,
  type CompiledMessage,
  type CompiledMessageBranch,
  type CompiledMessageBranches,
  type CompiledMessageRuntime,
  type ExecutableMessageRenderer,
  type MessageValues,
} from "./compiledMessage";
export {
  formatMessageArgument,
  replacePoundPlaceholders,
  stringifyValue,
  type MessageFormat,
} from "./runtimeFormat";
export type {
  CreateI18nOptions,
  MessageFormatErrorInfo,
  MessageMetadata,
  MissingMessageInfo,
  PalamedesI18n,
} from "./i18nRuntime";
export type { PluralProps, SelectProps, SelectOrdinalProps } from "./choice";
