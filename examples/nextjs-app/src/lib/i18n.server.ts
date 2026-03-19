import "server-only"

import { cookies } from "next/headers"
import { setServerI18nGetter } from "@palamedes/runtime"
import { createExampleI18n, Locale, LOCALES, DEFAULT_LOCALE, loadMessages } from "./i18n"

/**
 * Get the current locale from cookies (server-side only)
 */
export async function getLocale(): Promise<Locale> {
  const cookieStore = await cookies()
  const locale = cookieStore.get("locale")?.value as Locale | undefined
  return locale && LOCALES.includes(locale) ? locale : DEFAULT_LOCALE
}

/**
 * Initialize i18n for server-side rendering and register the request-local instance.
 */
export async function initI18nServer(): Promise<Locale> {
  const locale = await getLocale()
  const messages = await loadMessages(locale)
  const i18n = createExampleI18n()

  i18n.load(locale, messages)
  i18n.activate(locale)
  setServerI18nGetter(() => i18n)

  return locale
}
