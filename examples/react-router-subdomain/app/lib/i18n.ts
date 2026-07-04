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

/**
 * Resolve the authoritative locale from the request `Host` header. The subdomain
 * strategy reads the leftmost DNS label (`de.lvh.me` -> `de`) and falls back to
 * the default locale when the label is missing or unknown. The banner surfaces
 * an Accept-Language hint when the visitor's preferred locale differs from the
 * one the host is currently serving.
 */
export function resolveSubdomainLocale(request: Request) {
  const host = request.headers.get("host")
  const acceptLanguageHeader = request.headers.get("accept-language")

  const resolved = locales.resolve({
    strategy: "subdomain",
    acceptLanguageHeader,
    requestHost: host,
  })

  return {
    banner: locales.suggest({
      acceptLanguageHeader,
      cookieHeader: request.headers.get("cookie"),
      currentLocale: resolved.locale,
      pathname: "/",
      requestHost: host,
    }),
    host,
    locale: resolved.locale,
    source: resolved.source,
  }
}

export function resolveLocaleFromRequest(request: Request): Locale {
  return resolveSubdomainLocale(request).locale
}
