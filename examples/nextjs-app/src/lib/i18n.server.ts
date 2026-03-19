import "server-only"

import { cookies } from "next/headers"
import { setServerI18nGetter } from "@palamedes/runtime"
import type { PalamedesI18n } from "@palamedes/core"
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
 * Initialize a request-local i18n instance and register it for server-side rendering.
 */
export async function createActiveServerI18n(locale?: Locale): Promise<{
  i18n: PalamedesI18n
  locale: Locale
}> {
  const resolvedLocale = locale ?? await getLocale()
  const messages = await loadMessages(resolvedLocale)
  const i18n = createExampleI18n()

  i18n.load(resolvedLocale, messages)
  i18n.activate(resolvedLocale)
  setServerI18nGetter(() => i18n)

  return {
    i18n,
    locale: resolvedLocale,
  }
}

/**
 * Initialize i18n for server-side rendering and register the request-local instance.
 */
export async function initI18nServer(): Promise<Locale> {
  const { locale } = await createActiveServerI18n()
  return locale
}
