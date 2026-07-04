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
 * code. `.com` maps to `en` via an explicit `tld` override (its label is not a
 * locale code); `defaultTld: "com"` also routes the `en` switch back to `.com`.
 */
export const locales = defineLocaleControls<Locale>({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  hosts: { mode: "tld", tld: { com: "en" }, defaultTld: "com" },
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
