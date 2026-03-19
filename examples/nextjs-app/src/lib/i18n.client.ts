import { createExampleI18n, type Locale } from "./i18n"
import { setClientI18n } from "@palamedes/runtime"
import { messages as enMessages } from "../locales/en.po"
import { messages as deMessages } from "../locales/de.po"
import { messages as esMessages } from "../locales/es.po"

const localeMessages = {
  en: enMessages,
  de: deMessages,
  es: esMessages,
} as const

const clientI18n = createExampleI18n()

export function syncClientI18n(locale: Locale) {
  clientI18n.load(locale, localeMessages[locale])
  clientI18n.activate(locale)
  setClientI18n(clientI18n)
  return clientI18n
}
