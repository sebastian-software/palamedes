import type { CatalogMessages } from "@palamedes/core"
import { createI18n } from "@palamedes/core"
import { setClientI18n, setServerI18nGetter } from "@palamedes/runtime"
import { defineLocaleControls } from "@palamedes/core/locale"
import { messages as enMessages } from "../locales/en.po"
import { messages as deMessages } from "../locales/de.po"
import { messages as esMessages } from "../locales/es.po"

export const LOCALES = ["en", "de", "es"] as const
export const DEFAULT_LOCALE = "en"
export const LOCALE_COOKIE = "locale"
export type Locale = (typeof LOCALES)[number]

/** Headless locale controls for this demo (cookie strategy). */
export const locales = defineLocaleControls<Locale>({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  cookies: { locale: LOCALE_COOKIE },
})

export const LOCALE_LABELS = locales.labels

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

export function resolveLocaleFromRequest(request: Request) {
  return locales.resolve({
    strategy: "cookie",
    acceptLanguageHeader: request.headers.get("accept-language"),
    cookieHeader: request.headers.get("cookie"),
  })
}
