import type { CatalogMessages } from "@palamedes/core"
import { createI18n } from "@palamedes/core"
import { setClientI18n } from "@palamedes/runtime"
import { messages as deMessages } from "../locales/de.po"
import { messages as enMessages } from "../locales/en.po"
import { messages as esMessages } from "../locales/es.po"

export const DEFAULT_LOCALE = "en"
export const LOCALES = ["en", "de", "es"] as const

export type Locale = (typeof LOCALES)[number]

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  de: "Deutsch",
  es: "Espanol",
}

export const localeMessages: Record<Locale, CatalogMessages> = {
  en: enMessages,
  de: deMessages,
  es: esMessages,
}

const clientI18n = createI18n()

export function createExampleI18n() {
  return createI18n()
}

export function normalizeLocale(value: unknown): Locale {
  return typeof value === "string" && LOCALES.includes(value as Locale)
    ? (value as Locale)
    : DEFAULT_LOCALE
}

export function getLocaleLabel(locale: Locale): string {
  return LOCALE_LABELS[locale]
}

export function syncClientI18n(locale: Locale) {
  if (typeof window === "undefined") {
    return
  }

  clientI18n.load(locale, localeMessages[locale])
  clientI18n.activate(locale)
  setClientI18n(clientI18n)
}
