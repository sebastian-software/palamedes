import type { CatalogMessages } from "@palamedes/core"
import { defineLocaleControls, type LocaleSource } from "@palamedes/core/locale"
import { createRemixI18nServer } from "@palamedes/remix/server"
import { messages as deMessages } from "./locales/de.po"
import { messages as enMessages } from "./locales/en.po"
import { messages as esMessages } from "./locales/es.po"

export const LOCALES = ["en", "de", "es"] as const
export const DEFAULT_LOCALE = "en"

export type Locale = (typeof LOCALES)[number]
export type ResolvedLocale = {
  locale: Locale
  source: LocaleSource
}

export const locales = defineLocaleControls<Locale>({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
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

export const remixI18n = createRemixI18nServer({
  locales,
  strategy: "route",
  loadMessages,
  routeParam: "locale",
})

export function resolveLocaleFromRequest(request: Request): ResolvedLocale {
  return remixI18n.resolveLocale(request)
}

export function getRootRedirectLocale(request: Request): Locale {
  return locales.preferredLocale(request.headers.get("accept-language"))
}

export function getRouteBanner(request: Request, locale: Locale): string | null {
  const suggestion = locales.suggest({
    acceptLanguageHeader: request.headers.get("accept-language"),
    currentLocale: locale,
    pathname: `/${locale}`,
  })

  return suggestion
    ? `${suggestion.description} Switch to the recommended locale: ${suggestion.recommendedLocale}.`
    : null
}

export function getRouteSwitchLinks() {
  return LOCALES.map((locale) => ({ href: `/${locale}`, locale }))
}
