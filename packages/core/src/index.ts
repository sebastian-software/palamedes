import { formatMessagePattern, parseMessagePattern } from "./messageFormat"

export interface MessageDescriptor {
  id?: string
  message?: string
  context?: string
  comment?: string
}

export type CatalogMessages = Record<string, string>

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

export function createI18n(): PalamedesI18n {
  const catalogs = new Map<string, CatalogMessages>()
  let activeLocale: string | undefined

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
      const catalog = activeLocale ? catalogs.get(activeLocale) : undefined
      return catalog?.[id] ?? descriptor?.message ?? id
    },

    _(idOrDescriptor, values = {}, descriptor) {
      if (typeof idOrDescriptor === "string") {
        return formatMessagePattern(this.getMessage(idOrDescriptor, descriptor), values, activeLocale)
      }

      return formatMessagePattern(idOrDescriptor.message ?? "", values, activeLocale)
    },
  }
}

export { formatMessagePattern, parseMessagePattern }
export type { MessageNode, MessageChoiceNode, MessageTagNode, MessageVariableNode } from "./messageFormat"
