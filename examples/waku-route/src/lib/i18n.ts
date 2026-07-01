import { createI18n } from "@palamedes/core"
import { setClientI18n, setServerI18nGetter } from "@palamedes/runtime"
import { defineLocaleControls } from "@palamedes/core/locale"
import { messages as deMessages } from "../locales/de.po"
import { messages as enMessages } from "../locales/en.po"
import { messages as esMessages } from "../locales/es.po"

export const LOCALES = ["en", "de", "es"] as const
export const DEFAULT_LOCALE = "en"
export type Locale = (typeof LOCALES)[number]

/** Headless locale controls for this demo (route strategy + host map). */
export const locales = defineLocaleControls<Locale>({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  hosts: {
    locales: {
      en: "en.lvh.me",
      de: "de.lvh.me",
      es: "es.lvh.me",
    },
  },
})

export const LOCALE_LABELS = locales.labels
export const isLocale = locales.isLocale
export const normalizeLocale = locales.normalizeLocale

const localeMessages = {
  en: enMessages,
  de: deMessages,
  es: esMessages,
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
    pathname: `/${locale}`,
    requestHost: headers.host,
  })
}
