import type { CatalogMessages } from "@palamedes/core"
import { createI18n } from "@palamedes/core"
import { setClientI18n } from "@palamedes/runtime"
import { defineLocaleControls } from "@palamedes/core/locale"
import { messages as deMessages } from "../locales/de.po"
import { messages as enMessages } from "../locales/en.po"
import { messages as esMessages } from "../locales/es.po"

export const LOCALES = ["en", "de", "es"] as const
export const DEFAULT_LOCALE = "en"
export const LOCALE_COOKIE = "locale"
export type Locale = (typeof LOCALES)[number]

/** Headless locale controls for this demo (route strategy + host map). */
export const locales = defineLocaleControls<Locale>({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  cookies: { locale: LOCALE_COOKIE },
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

export const localeMessages: Record<Locale, CatalogMessages> = {
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

export function syncClientI18n(locale: Locale) {
  if (typeof window === "undefined") {
    return
  }

  clientI18n.load(locale, localeMessages[locale])
  clientI18n.activate(locale)
  setClientI18n(clientI18n)
}

function bootstrapClientI18n() {
  if (typeof window === "undefined") {
    return
  }

  const pathLocale = window.location.pathname.split("/").filter(Boolean)[0] ?? DEFAULT_LOCALE
  syncClientI18n(normalizeLocale(pathLocale))
}

bootstrapClientI18n()
