import { createI18n } from "@palamedes/core"
import type { CompiledCatalogMessages } from "@palamedes/core/compiled"
import { setClientI18n } from "@palamedes/runtime"
import { defineLocaleControls } from "@palamedes/core/locale"
import { messages as deMessages } from "../locales/de.po"
import { messages as enMessages } from "../locales/en.po"
import { messages as esMessages } from "../locales/es.po"

export const LOCALES = ["en", "de", "es"] as const
export const DEFAULT_LOCALE = "en"
export const LOCALE_COOKIE = "locale"
export type Locale = (typeof LOCALES)[number]

/**
 * Headless locale controls for this demo (subdomain strategy). The leftmost DNS
 * label is authoritative for the locale (`de.lvh.me` -> `de`), so no per-locale
 * host map is needed and the same config works across `lvh.me` and production.
 */
export const locales = defineLocaleControls<Locale>({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  cookies: { locale: LOCALE_COOKIE },
  hosts: { mode: "subdomain" },
})

export const LOCALE_LABELS = locales.labels
export const normalizeLocale = locales.normalizeLocale

export const localeMessages: Record<Locale, CompiledCatalogMessages> = {
  en: enMessages,
  de: deMessages,
  es: esMessages,
}

const clientI18n = createI18n()

export function createExampleI18n() {
  return createI18n()
}

export function getLocaleLabel(locale: Locale): string {
  return locales.label(locale)
}

export function initializeClientI18n(locale: Locale) {
  if (typeof window === "undefined") {
    return
  }

  clientI18n.load(locale, localeMessages[locale])
  clientI18n.activate(locale)
  setClientI18n(clientI18n)
}

// The host label is authoritative for the server, not for the client: a host
// without a locale label (`localhost`, a bare preview domain) makes the server
// fall back to Accept-Language, which client code cannot read. Re-deriving the
// locale from `window.location` would therefore diverge from the document the
// root route rendered, so the server-rendered `lang` is the source here.
if (typeof window !== "undefined") {
  const locale = document.documentElement.lang
  if (!locales.isLocale(locale)) {
    throw new Error(
      `Expected a supported server document locale, received ${JSON.stringify(locale)}`
    )
  }

  initializeClientI18n(locale)
}
