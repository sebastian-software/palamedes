import { createI18n } from "@palamedes/core"
import { activateServerI18n as activateScopedServerI18n, setClientI18n } from "@palamedes/runtime"
import { defineLocaleControls } from "@palamedes/core/locale"
import { messages as deMessages } from "../locales/de.po"
import { messages as enMessages } from "../locales/en.po"
import { messages as esMessages } from "../locales/es.po"

export const LOCALES = ["en", "de", "es"] as const
export const DEFAULT_LOCALE = "en"
export type Locale = (typeof LOCALES)[number]

/**
 * Headless locale controls for this demo (subdomain strategy). The leftmost DNS
 * label is authoritative for the locale (`de.lvh.me` -> `de`), so no per-locale
 * host map is needed and the same config works across `lvh.me` and production.
 */
export const locales = defineLocaleControls<Locale>({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  hosts: { mode: "subdomain" },
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

export function createServerI18n(locale: Locale) {
  const i18n = createI18n()
  i18n.load(locale, localeMessages[locale])
  i18n.activate(locale)
  return i18n
}

export function activateServerI18n(locale: Locale) {
  return activateScopedServerI18n(createServerI18n(locale))
}

export function initializeClientI18n(locale: Locale) {
  clientI18n.load(locale, localeMessages[locale])
  clientI18n.activate(locale)

  if (typeof window !== "undefined") {
    setClientI18n(clientI18n)
  }

  return clientI18n
}

if (typeof window !== "undefined") {
  initializeClientI18n(normalizeLocale(window.location.hostname.split(".")[0]))
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
