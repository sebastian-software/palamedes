import { createI18nRuntime, type CreateI18nOptions } from "./i18nRuntime"
import { formatMessageArgument, formatMessagePattern, parseMessagePattern } from "./messageFormat"

export function createI18n(options: CreateI18nOptions = {}) {
  const i18n = createI18nRuntime(options, {
    formatPattern: formatMessagePattern,
    parsePattern: parseMessagePattern,
  })
  i18n.parsePattern = parseMessagePattern
  return i18n
}

export { DEFAULT_LOCALE } from "./i18nRuntime"
export type {
  CreateI18nOptions,
  MessageFormatErrorInfo,
  MessageMetadata,
  MissingMessageInfo,
  PalamedesI18n,
  ReportedMessageError,
} from "./i18nRuntime"
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
