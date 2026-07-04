import type { CatalogMessages } from "@palamedes/core"
import { createI18n } from "@palamedes/core"
import { setClientI18n } from "@palamedes/runtime"
import { defineLocaleControls } from "@palamedes/core/locale"
import { messages as deMessages } from "../locales/de.po"
import { messages as enMessages } from "../locales/en.po"
import { messages as esMessages } from "../locales/es.po"
import { messages as frMessages } from "../locales/fr.po"

export const LOCALES = ["en", "de", "es", "fr"] as const
export const DEFAULT_LOCALE = "en"
export const LOCALE_COOKIE = "locale"
export type Locale = (typeof LOCALES)[number]

/**
 * Headless locale controls for this demo (TLD strategy). The rightmost DNS
 * label (top-level domain) is authoritative for the locale: `.de` → `de`,
 * `.es` → `es`, `.fr` → `fr`. `.com` is not authoritative — Accept-Language
 * / default (`en`) acts as the fallback. `defaultTld: "com"` is the switch
 * target for the `en` locale so the switcher can build the correct URL.
 */
export const locales = defineLocaleControls<Locale>({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  cookies: { locale: LOCALE_COOKIE },
  hosts: { mode: "tld", defaultTld: "com" },
})

export const LOCALE_LABELS = locales.labels
export const normalizeLocale = locales.normalizeLocale

export const localeMessages: Record<Locale, CatalogMessages> = {
  en: enMessages,
  de: deMessages,
  es: esMessages,
  fr: frMessages,
}

const clientI18n = createI18n()

export function createExampleI18n() {
  return createI18n()
}

export function getLocaleLabel(locale: Locale): string {
  return locales.label(locale)
}

export function syncClientI18n(locale: Locale) {
  if (typeof window === "undefined") {
    return
  }

  clientI18n.load(locale, localeMessages[locale])
  clientI18n.activate(locale)
  setClientI18n(clientI18n)
}
