import type { CatalogMessages } from "@palamedes/core"
import { createI18n } from "@palamedes/core"
import { setClientI18n, setServerI18nGetter } from "@palamedes/runtime"
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_LABELS,
  createRouteLocaleBanner,
  getPreferredLocale,
  type HostLocaleConfig,
  type Locale,
} from "@palamedes/example-locale-shared"

export {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_LABELS,
  type Locale,
}

export const ROUTE_HOSTS: HostLocaleConfig = {
  locales: {
    en: "en.lvh.me",
    de: "de.lvh.me",
    es: "es.lvh.me",
  },
}

export async function loadMessages(locale: Locale): Promise<CatalogMessages> {
  const { messages } = await import(`../locales/${locale}.po`)
  return messages
}

export function createExampleI18n() {
  return createI18n()
}

export async function activateServerI18n(locale: Locale) {
  const messages = await loadMessages(locale)
  const i18n = createExampleI18n()
  i18n.load(locale, messages)
  i18n.activate(locale)
  setServerI18nGetter(() => i18n)
  return i18n
}

const clientI18n = createExampleI18n()

export async function syncClientI18n(locale: Locale) {
  if (typeof document === "undefined") {
    return
  }

  const messages = await loadMessages(locale)
  clientI18n.load(locale, messages)
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
    currentLocale: locale,
    hostConfig: ROUTE_HOSTS,
    pathname: `/${locale}`,
    requestHost: request.headers.get("host"),
  })
}
