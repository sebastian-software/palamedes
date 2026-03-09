import "server-only"

import { cookies } from "next/headers"
import { setI18n } from "@lingui/react/server"
import { i18n, Locale, LOCALES, DEFAULT_LOCALE, loadMessages } from "./i18n"

/**
 * Get the current locale from cookies (server-side only)
 */
export async function getLocale(): Promise<Locale> {
  const cookieStore = await cookies()
  const locale = cookieStore.get("locale")?.value as Locale | undefined
  return locale && LOCALES.includes(locale) ? locale : DEFAULT_LOCALE
}

/**
 * Initialize i18n for server-side rendering
 * Sets up both i18n.activate() and setI18n() for RSC support
 */
export async function initI18nServer(): Promise<Locale> {
  const locale = await getLocale()
  const messages = await loadMessages(locale)

  i18n.load(locale, messages)
  i18n.activate(locale)

  // Required for <Trans> and useLingui() in Server Components
  setI18n(i18n)

  return locale
}
