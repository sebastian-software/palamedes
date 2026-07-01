import type { CatalogMessages } from "@palamedes/core"
import { createI18n } from "@palamedes/core"
import { setClientI18n, setServerI18nGetter } from "@palamedes/runtime"
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_LABELS,
  createRouteLocaleBanner,
  getLocaleLabel,
  getPreferredLocale,
  normalizeLocale,
  parseChoiceLocale,
  type HostLocaleConfig,
  type Locale,
} from "@palamedes/example-locale-shared"
import { messages as enMessages } from "../locales/en.po"
import { messages as deMessages } from "../locales/de.po"
import { messages as esMessages } from "../locales/es.po"

export { DEFAULT_LOCALE, LOCALES, LOCALE_LABELS, getLocaleLabel, normalizeLocale, type Locale }

export const ROUTE_HOSTS: HostLocaleConfig = {
  locales: {
    en: "en.lvh.me",
    de: "de.lvh.me",
    es: "es.lvh.me",
  },
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
  return getPreferredLocale(request.headers.get("accept-language"))
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
  return createRouteLocaleBanner({
    acceptLanguageHeader: request.headers.get("accept-language"),
    choiceLocale: parseChoiceLocale(request.headers.get("cookie")),
    currentLocale: locale,
    hostConfig: ROUTE_HOSTS,
    pathname: `/${locale}`,
    requestHost: request.headers.get("host"),
  })
}
