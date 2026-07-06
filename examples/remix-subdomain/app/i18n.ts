import type { CatalogMessages } from "@palamedes/core"
import { defineLocaleControls, type LocaleSource } from "@palamedes/core/locale"
import { createRemixI18nServer } from "@palamedes/remix/server"
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
  hosts: { mode: "subdomain" },
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
  strategy: "subdomain",
  loadMessages,
})

export function resolveLocaleFromRequest(request: Request): ResolvedLocale {
  return remixI18n.resolveLocale(request)
}

export function getSubdomainBanner(request: Request, locale: Locale): string | null {
  const suggestion = locales.suggest({
    acceptLanguageHeader: request.headers.get("accept-language"),
    cookieHeader: request.headers.get("cookie"),
    currentLocale: locale,
    pathname: "/",
    requestHost: request.headers.get("host"),
  })

  return suggestion
    ? `${suggestion.description} Switch to the recommended locale: ${suggestion.recommendedLocale}.`
    : null
}

export function getSubdomainSwitchLinks(request: Request) {
  const host = request.headers.get("host") ?? "lvh.me:4062"
  return LOCALES.map((locale) => ({
    href: locales.canonicalUrl({ locale, pathname: "/", requestHost: host }),
    locale,
  }))
}
