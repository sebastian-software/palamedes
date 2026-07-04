import { createI18n } from "@palamedes/core"
import type { CatalogMessages } from "@palamedes/core"
import { defineLocaleControls } from "@palamedes/core/locale"

export const LOCALES = ["en", "de", "es", "fr"] as const
export const DEFAULT_LOCALE = "en"
export type Locale = (typeof LOCALES)[number]

/**
 * Headless locale controls for this demo (TLD strategy). The locale comes from
 * the top-level domain (rightmost label): `.de` → de, `.es` → es, `.fr` → fr
 * are automatically authoritative because the country code matches the language
 * code. `.com` is not authoritative and falls back to Accept-Language / default
 * (en). `defaultTld: "com"` is the switch target for the default locale en.
 */
export const locales = defineLocaleControls<Locale>({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  hosts: { mode: "tld", defaultTld: "com" },
})

export const LOCALE_LABELS = locales.labels

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
  return locales.label(locale)
}
