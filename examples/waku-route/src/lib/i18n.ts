import { createI18n } from "@palamedes/core"
import { setClientI18n, setServerI18nGetter } from "@palamedes/runtime"
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_LABELS,
  createRouteLocaleBanner,
  isLocale,
  normalizeLocale,
  type HostLocaleConfig,
  type Locale,
} from "@palamedes/example-locale-shared"
import { messages as deMessages } from "../locales/de.po"
import { messages as enMessages } from "../locales/en.po"
import { messages as esMessages } from "../locales/es.po"

export {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_LABELS,
  isLocale,
  normalizeLocale,
  type Locale,
}

export const HOSTS: HostLocaleConfig = {
  locales: {
    en: "en.lvh.me",
    de: "de.lvh.me",
    es: "es.lvh.me",
  },
}

const localeMessages = {
  en: enMessages,
  de: deMessages,
  es: esMessages,
} as const

const clientI18n = createI18n()

export function getLocaleLabel(locale: Locale) {
  return LOCALE_LABELS[locale]
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

export function createBanner(
  headers: Record<string, string | undefined>,
  locale: Locale
) {
  return createRouteLocaleBanner({
    acceptLanguageHeader: headers["accept-language"],
    currentLocale: locale,
    hostConfig: HOSTS,
    pathname: `/${locale}`,
    requestHost: headers.host,
  })
}
