import "server-only"

import { cookies } from "next/headers"
import { headers } from "next/headers"
import { setServerI18nGetter } from "@palamedes/runtime"
import type { PalamedesI18n } from "@palamedes/core"
import { resolveCookieLocale, type LocaleSource } from "@palamedes/example-locale-shared"
import { createExampleI18n, type Locale, loadMessages } from "./i18n"

/**
 * Get the current locale from cookies (server-side only)
 */
export async function getLocale(): Promise<{ locale: Locale; source: LocaleSource }> {
  const cookieStore = await cookies()
  const headerStore = await headers()
  const resolved = resolveCookieLocale({
    acceptLanguageHeader: headerStore.get("accept-language"),
    cookieHeader: headerStore.get("cookie") ?? cookieStore.toString(),
  })

  return resolved
}

/**
 * Initialize a request-local i18n instance and register it for server-side rendering.
 */
export async function createActiveServerI18n(locale?: Locale): Promise<{
  i18n: PalamedesI18n
  locale: Locale
  source: LocaleSource
}> {
  const resolved = locale
    ? { locale, source: "cookie" as const }
    : await getLocale()
  const resolvedLocale = resolved.locale
  const messages = await loadMessages(resolvedLocale)
  const i18n = createExampleI18n()

  i18n.load(resolvedLocale, messages)
  i18n.activate(resolvedLocale)
  setServerI18nGetter(() => i18n)

  return {
    i18n,
    locale: resolvedLocale,
    source: resolved.source,
  }
}

/**
 * Initialize i18n for server-side rendering and register the request-local instance.
 */
export async function initI18nServer(): Promise<Locale> {
  const { locale } = await createActiveServerI18n()
  return locale
}
