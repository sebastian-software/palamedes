import { createI18n, type CatalogMessages, type PalamedesI18n } from "@palamedes/core"
import { defineLocaleControls, type LocaleSource } from "@palamedes/core/locale"
import { createRemixI18nRequestScope } from "@palamedes/remix/server"
import { messages as deMessages } from "./locales/de.po"
import { messages as enMessages } from "./locales/en.po"
import { messages as esMessages } from "./locales/es.po"

export const LOCALES = ["en", "de", "es"] as const
export const DEFAULT_LOCALE = "en"
export const LOCALE_COOKIE = "locale"

export type Locale = (typeof LOCALES)[number]
export type ResolvedLocale = {
  locale: Locale
  source: LocaleSource
}

export const locales = defineLocaleControls<Locale>({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  cookies: { locale: LOCALE_COOKIE },
})

export const LOCALE_LABELS = locales.labels
export const normalizeLocale = locales.normalizeLocale

const CATALOGS: Record<Locale, CatalogMessages> = {
  en: enMessages,
  de: deMessages,
  es: esMessages,
}

export function getLocaleLabel(locale: Locale): string {
  return locales.label(locale)
}

export function loadMessages(locale: Locale): CatalogMessages {
  return CATALOGS[locale]
}

export function createActiveI18n(locale: Locale): PalamedesI18n {
  const i18n = createI18n()
  i18n.load(locale, loadMessages(locale))
  i18n.activate(locale)
  return i18n
}

export function resolveLocaleFromRequest(request: Request): ResolvedLocale {
  return locales.resolve({
    strategy: "cookie",
    acceptLanguageHeader: request.headers.get("accept-language"),
    cookieHeader: request.headers.get("cookie"),
  })
}

export function serializeLocaleCookie(locale: Locale): string {
  return `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`
}

export const remixI18n = createRemixI18nRequestScope<PalamedesI18n>((request) =>
  createActiveI18n(resolveLocaleFromRequest(request).locale)
)
