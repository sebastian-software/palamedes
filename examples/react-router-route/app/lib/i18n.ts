import type { CatalogMessages } from "@palamedes/core"
import { createI18n } from "@palamedes/core"
import { setClientI18n, setServerI18nGetter } from "@palamedes/runtime"
import { defineLocaleControls } from "@palamedes/core/locale"
import { messages as enMessages } from "../locales/en.po"
import { messages as deMessages } from "../locales/de.po"
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
export const normalizeLocale = locales.normalizeLocale

export function getLocaleLabel(locale: Locale): string {
  return locales.label(locale)
}

// Demo catalogs are tiny, so they ship statically. That keeps client locale
// activation synchronous, which matters during hydration: translated components
// render in the same pass as the activation call, before any async load could
// resolve. Larger apps would dynamically import per-locale chunks instead.
const CATALOGS: Record<Locale, CatalogMessages> = {
  en: enMessages,
  de: deMessages,
  es: esMessages,
}

export function loadMessages(locale: Locale): CatalogMessages {
  return CATALOGS[locale]
}

export function createExampleI18n() {
  return createI18n()
}

export function activateServerI18n(locale: Locale) {
  const i18n = createExampleI18n()
  i18n.load(locale, loadMessages(locale))
  i18n.activate(locale)
  setServerI18nGetter(() => i18n)
  return i18n
}

const clientI18n = createExampleI18n()

export function syncClientI18n(locale: Locale) {
  if (typeof document === "undefined") {
    return
  }

  clientI18n.load(locale, loadMessages(locale))
  clientI18n.activate(locale)
  setClientI18n(clientI18n)
}

export function getRootRedirectLocale(request: Request) {
  return locales.preferredLocale(request.headers.get("accept-language"))
}

export function resolveLocaleFromRequest(request: Request): Locale {
  const pathname = new URL(request.url).pathname
  const segment = pathname.split("/").filter(Boolean)[0]

  if (LOCALES.includes(segment as Locale)) {
    return segment as Locale
  }

  return getRootRedirectLocale(request)
}

export function getRouteBanner(request: Request, locale: Locale) {
  return locales.suggest({
    acceptLanguageHeader: request.headers.get("accept-language"),
    cookieHeader: request.headers.get("cookie"),
    currentLocale: locale,
    pathname: `/${locale}`,
    requestHost: request.headers.get("host"),
  })
}
