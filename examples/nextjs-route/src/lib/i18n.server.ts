import "server-only"

import { headers } from "next/headers"
import { createServerI18nScope } from "@palamedes/runtime/server"
import type { PalamedesI18n } from "@palamedes/core"
import {
  createRouteLocaleBanner,
  parseChoiceLocale,
  resolveRouteLocale,
  type LocaleBanner,
  type LocaleSource,
} from "@palamedes/example-locale-shared"
import { createExampleI18n, DEFAULT_LOCALE, type Locale, ROUTE_HOSTS, loadMessages } from "./i18n"

export const serverI18nScope = createServerI18nScope<PalamedesI18n>()

export async function getRouteLocale(paramsLocale?: string): Promise<{
  banner: LocaleBanner | null
  locale: Locale
  source: LocaleSource
}> {
  const headerStore = await headers()
  const pathname =
    paramsLocale && paramsLocale !== DEFAULT_LOCALE ? `/${paramsLocale}` : `/${paramsLocale ?? ""}`
  const resolved = resolveRouteLocale({
    acceptLanguageHeader: headerStore.get("accept-language"),
    routeLocale: paramsLocale,
  })

  return {
    banner: createRouteLocaleBanner({
      acceptLanguageHeader: headerStore.get("accept-language"),
      choiceLocale: parseChoiceLocale(headerStore.get("cookie")),
      currentLocale: resolved.locale,
      hostConfig: ROUTE_HOSTS,
      pathname,
      requestHost: headerStore.get("host"),
    }),
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
