import { createI18n } from "@palamedes/core"
import { setClientI18n, setServerI18nGetter } from "@palamedes/runtime"
import { defineLocaleControls } from "@palamedes/core/locale"
import { messages as deMessages } from "../locales/de.po"
import { messages as enMessages } from "../locales/en.po"
import { messages as esMessages } from "../locales/es.po"
import { messages as frMessages } from "../locales/fr.po"

export const LOCALES = ["en", "de", "es", "fr"] as const
export const DEFAULT_LOCALE = "en"
export type Locale = (typeof LOCALES)[number]

/**
 * Headless locale controls for this demo (TLD strategy). The rightmost DNS
 * label is authoritative for the locale (`.de` -> `de`, `.es` -> `es`,
 * `.fr` -> `fr`). The default TLD `.com` is not authoritative — there
 * Accept-Language is consulted and falls back to `en`. Set `defaultTld:"com"`
 * so the locale switcher navigates to the `.com` domain when switching to `en`.
 */
export const locales = defineLocaleControls<Locale>({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  hosts: { mode: "tld", defaultTld: "com" },
})

export const LOCALE_LABELS = locales.labels
export const isLocale = locales.isLocale
export const normalizeLocale = locales.normalizeLocale

const localeMessages = {
  en: enMessages,
  de: deMessages,
  es: esMessages,
  fr: frMessages,
} as const

const clientI18n = createI18n()

export function getLocaleLabel(locale: Locale) {
  return locales.label(locale)
}

export function activateServerI18n(locale: Locale) {
  const i18n = createI18n()
  i18n.load(locale, localeMessages[locale])
  i18n.activate(locale)
  setServerI18nGetter(() => i18n)
  return i18n
}

export function syncClientI18n(locale: Locale) {
  clientI18n.load(locale, localeMessages[locale])
  clientI18n.activate(locale)

  if (typeof window === "undefined") {
    setServerI18nGetter(() => clientI18n)
  } else {
    setClientI18n(clientI18n)
  }

  return clientI18n
}

export function createBanner(headers: Record<string, string | undefined>, locale: Locale) {
  return locales.suggest({
    acceptLanguageHeader: headers["accept-language"],
    cookieHeader: headers.cookie,
    currentLocale: locale,
    pathname: "/",
    requestHost: headers.host,
  })
}
