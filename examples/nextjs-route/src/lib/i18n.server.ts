import "server-only"

import { headers } from "next/headers"
import { createNextServerI18nScope } from "@palamedes/next-plugin/server"
import type { CompiledPalamedesI18n } from "@palamedes/core/compiled"
import type { LocaleSource, LocaleSuggestion } from "@palamedes/core/locale"
import { createExampleI18n, type Locale, loadMessages, locales } from "./i18n"

export const serverI18nScope = createNextServerI18nScope<CompiledPalamedesI18n>()

export function runWithServerI18n<Result>(
  i18n: CompiledPalamedesI18n,
  callback: () => Result
): Result {
  return serverI18nScope.run(i18n, callback)
}

export async function getRouteLocale(paramsLocale?: string): Promise<{
  banner: LocaleSuggestion<Locale> | null
  locale: Locale
  source: LocaleSource
}> {
  const headerStore = await headers()
  const pathname = `/${paramsLocale ?? ""}`
  const resolved = locales.resolve({
    strategy: "route",
    acceptLanguageHeader: headerStore.get("accept-language"),
    routeLocale: paramsLocale,
  })

  return {
    banner: locales.suggest({
      acceptLanguageHeader: headerStore.get("accept-language"),
      cookieHeader: headerStore.get("cookie"),
      currentLocale: resolved.locale,
      pathname,
      requestHost: headerStore.get("host"),
    }),
    locale: resolved.locale,
    source: resolved.source,
  }
}

export async function createActiveServerI18n(locale: Locale): Promise<{
  i18n: CompiledPalamedesI18n
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
