import { createI18n } from "@palamedes/core/compiled"
import { setClientI18n } from "@palamedes/runtime"

export const LOCALES = ["en", "de"] as const
export type Locale = (typeof LOCALES)[number]

export const i18n = createI18n()

export function activateLocale(locale: Locale) {
  i18n.activate(locale)
  setClientI18n(i18n)
  document.documentElement.lang = locale
}
