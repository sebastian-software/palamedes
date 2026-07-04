import "server-only"

import { headers } from "next/headers"
import { createServerI18nScope } from "@palamedes/runtime/server"
import type { PalamedesI18n } from "@palamedes/core"
import type { LocaleSource, LocaleSuggestion } from "@palamedes/core/locale"
import { createExampleI18n, type Locale, loadMessages, locales } from "./i18n"

export const serverI18nScope = createServerI18nScope<PalamedesI18n>()

export async function getSubdomainLocale(): Promise<{
  banner: LocaleSuggestion<Locale> | null
  host: string | null
  locale: Locale
  source: LocaleSource
}> {
  const headerStore = await headers()
  const host = headerStore.get("host")
  const resolved = locales.resolve({
    strategy: "subdomain",
    acceptLanguageHeader: headerStore.get("accept-language"),
    requestHost: host,
  })

  return {
    banner: locales.suggest({
      acceptLanguageHeader: headerStore.get("accept-language"),
      cookieHeader: headerStore.get("cookie"),
      currentLocale: resolved.locale,
      pathname: "/",
      requestHost: host,
    }),
    host,
    locale: resolved.locale,
    source: resolved.source,
  }
}

export async function createActiveServerI18n(locale: Locale): Promise<{
  i18n: PalamedesI18n
  locale: Locale
}> {
  const messages = await loadMessages(locale)
  const i18n = createExampleI18n()

  i18n.load(locale, messages)
  i18n.activate(locale)
  serverI18nScope.activate(i18n)

  return {
    i18n,
    locale,
  }
}
