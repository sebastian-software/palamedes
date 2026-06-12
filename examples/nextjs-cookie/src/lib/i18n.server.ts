import "server-only"

import { cache } from "react"
import { cookies } from "next/headers"
import { headers } from "next/headers"
import { createServerI18nScope } from "@palamedes/runtime/server"
import type { PalamedesI18n } from "@palamedes/core"
import { resolveCookieLocale, type LocaleSource } from "@palamedes/example-locale-shared"
import { createExampleI18n, type Locale, loadMessages } from "./i18n"

export const serverI18nScope = createServerI18nScope<PalamedesI18n>()

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
 * Initialize a request-local i18n instance for server-side rendering.
 */
const resolveActiveServerI18n = cache(
  async (
    locale?: Locale
  ): Promise<{
    i18n: PalamedesI18n
    locale: Locale
    source: LocaleSource
  }> => {
    const resolved = locale ? { locale, source: "cookie" as const } : await getLocale()
    const resolvedLocale = resolved.locale
    const messages = await loadMessages(resolvedLocale)
    const i18n = createExampleI18n()

    i18n.load(resolvedLocale, messages)
    i18n.activate(resolvedLocale)

    return {
      i18n,
      locale: resolvedLocale,
      source: resolved.source,
    }
  }
)

export async function createActiveServerI18n(locale?: Locale): Promise<{
  i18n: PalamedesI18n
  locale: Locale
  source: LocaleSource
}> {
  const active = await resolveActiveServerI18n(locale)
  serverI18nScope.activate(active.i18n)
  return active
}

export function runWithServerI18n<Result>(i18n: PalamedesI18n, callback: () => Result): Result {
  return serverI18nScope.run(i18n, callback)
}

/**
 * Initialize i18n for server-side rendering.
 */
export async function initI18nServer(): Promise<Locale> {
  const { locale } = await createActiveServerI18n()
  return locale
}
