import { createI18n, type CompiledCatalogMessages } from "@palamedes/core/compiled"
import { setClientI18n } from "@palamedes/runtime"

import { messages as deMessages } from "./locales/de.po"
import { messages as enMessages } from "./locales/en.po"

export const LOCALES = ["en", "de"] as const
export type Locale = (typeof LOCALES)[number]

const catalogs: Record<Locale, CompiledCatalogMessages> = {
  de: deMessages,
  en: enMessages,
}

export const i18n = createI18n()

export function activateLocale(locale: Locale) {
  i18n.load(locale, catalogs[locale])
  i18n.activate(locale)
  setClientI18n(i18n)
  document.documentElement.lang = locale
}
