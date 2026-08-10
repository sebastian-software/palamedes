import { createI18n } from "@palamedes/core"
import { activateServerI18n as activateScopedServerI18n, setClientI18n } from "@palamedes/runtime"
import { defineLocaleControls } from "@palamedes/core/locale"
import { messages as deMessages } from "../locales/de.po"
import { messages as enMessages } from "../locales/en.po"
import { messages as esMessages } from "../locales/es.po"
import { messages as frMessages } from "../locales/fr.po"

export const LOCALES = ["en", "de", "es", "fr"] as const
export const DEFAULT_LOCALE = "en"
export type Locale = (typeof LOCALES)[number]

declare global {
  interface Window {
    __PALAMEDES_LOCALE__?: string
  }
}

/**
 * Headless locale controls for this demo (TLD strategy). The rightmost DNS
 * label is authoritative for the locale (`.de` -> `de`, `.es` -> `es`,
 * `.fr` -> `fr`). `.com` maps to `en` via an explicit `tld` override (its
 * label is not a locale code). Set `defaultTld:"com"` so the locale switcher
 * navigates to the `.com` domain when switching to `en`.
 */
export const locales = defineLocaleControls<Locale>({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  hosts: { mode: "tld", tld: { com: "en" }, defaultTld: "com" },
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
    document.documentElement.lang = locale
    setClientI18n(clientI18n)
  }

  return clientI18n
}

// The tld is authoritative for the server, not for the client: a host without a
// locale tld (`localhost`, a bare preview domain) makes the server fall back to
// Accept-Language, which client code cannot read. Re-deriving the locale from
// `window.location` would therefore diverge from the rendered document, so the
// page injects the resolved server locale instead.
if (typeof window !== "undefined") {
  const locale = window.__PALAMEDES_LOCALE__
  if (!locales.isLocale(locale)) {
    throw new Error(
      `Expected an injected supported server locale, received ${JSON.stringify(locale)}`
    )
  }

  initializeClientI18n(locale)
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
