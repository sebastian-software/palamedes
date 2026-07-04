import { createServerFn } from "@tanstack/react-start"
import { getRequestHeader } from "@tanstack/react-start/server"
import { t } from "@palamedes/core/macro"
import { activateServerI18n } from "./i18n.server"
import { getLocaleLabel, locales, normalizeLocale } from "./i18n"

export const loadHomePageData = createServerFn({ method: "GET" }).handler(async () => {
  // Subdomain strategy: the leftmost DNS label of the request host is
  // authoritative for the locale, so we resolve it from the `Host` header
  // instead of a route param. Accept-Language / default act as the fallback
  // when the label is missing or unknown.
  const host = getRequestHeader("host") ?? null
  const acceptLanguageHeader = getRequestHeader("accept-language")
  const { locale } = locales.resolve({
    strategy: "subdomain",
    acceptLanguageHeader,
    requestHost: host,
  })
  activateServerI18n(locale)

  return {
    banner: locales.suggest({
      acceptLanguageHeader,
      cookieHeader: getRequestHeader("cookie"),
      currentLocale: locale,
      pathname: "/",
      requestHost: host,
    }),
    host,
    locale,
    localeLabel: getLocaleLabel(locale),
    renderedAt: new Date().toISOString(),
  }
})

export const getLocalizedServerStatus = createServerFn({ method: "GET" })
  .validator((data: { locale?: string } | undefined) => ({
    locale: normalizeLocale(data?.locale),
  }))
  .handler(async ({ data }) => {
    const locale = data.locale
    activateServerI18n(locale)

    return {
      locale,
      localeLabel: getLocaleLabel(locale),
      handledAt: new Date().toISOString(),
      message: t`Server function confirmed locale ${locale}.`,
    }
  })
