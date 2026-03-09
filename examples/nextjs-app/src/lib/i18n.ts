import { i18n, Messages } from "@lingui/core"

export const LOCALE_COOKIE = "locale"
export const DEFAULT_LOCALE = "en"
export const LOCALES = ["en", "de", "es"] as const

export type Locale = (typeof LOCALES)[number]

/**
 * Load messages for a locale (used on both server and client)
 */
export async function loadMessages(locale: Locale): Promise<Messages> {
  const { messages } = await import(`../locales/${locale}.po`)
  return messages
}

export { i18n }
