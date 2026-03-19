import { createI18n } from "@palamedes/core"
import type { CatalogMessages } from "@palamedes/core"

export const LOCALE_COOKIE = "locale"
export const DEFAULT_LOCALE = "en"
export const LOCALES = ["en", "de", "es"] as const

export type Locale = (typeof LOCALES)[number]
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  de: "Deutsch",
  es: "Espanol",
}

/**
 * Load messages for a locale (used on both server and client)
 */
export async function loadMessages(locale: Locale): Promise<CatalogMessages> {
  const { messages } = await import(`../locales/${locale}.po`)
  return messages
}

export function createExampleI18n() {
  return createI18n()
}

export function getLocaleLabel(locale: Locale): string {
  return LOCALE_LABELS[locale]
}
