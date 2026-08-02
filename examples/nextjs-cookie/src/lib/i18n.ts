import { createI18n } from "@palamedes/core"
import type { CompiledCatalogMessages } from "@palamedes/core/compiled"
import { defineLocaleControls } from "@palamedes/core/locale"

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

/**
 * Load messages for a locale (used on both server and client)
 */
export async function loadMessages(locale: Locale): Promise<CompiledCatalogMessages> {
  const { messages } = await import(`../locales/${locale}.po`)
  return messages
}

export function createExampleI18n() {
  return createI18n()
}

export function getLocaleLabel(locale: Locale): string {
  return locales.label(locale)
}
