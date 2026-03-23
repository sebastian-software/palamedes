import { createServerFn } from "@tanstack/react-start"
import { getRequestHeader, setCookie } from "@tanstack/react-start/server"
import { t } from "@palamedes/core/macro"
import { resolveCookieLocale } from "@palamedes/example-locale-shared"
import { activateServerI18n } from "./i18n.server"
import { getLocaleLabel, LOCALE_COOKIE, type Locale, normalizeLocale } from "./i18n"

function getResolvedLocale() {
  return resolveCookieLocale({
    acceptLanguageHeader: getRequestHeader("accept-language"),
    cookieHeader: getRequestHeader("cookie"),
  })
}

export const loadHomePageData = createServerFn({ method: "GET" })
  .handler(async () => {
    const resolved = getResolvedLocale()
    activateServerI18n(resolved.locale)

    return {
      locale: resolved.locale,
      localeLabel: getLocaleLabel(resolved.locale),
      renderedAt: new Date().toISOString(),
      source: resolved.source,
    }
  })

export const setLocaleCookie = createServerFn({ method: "POST" })
  .inputValidator((data: { locale?: string } | undefined) => ({
    locale: normalizeLocale(data?.locale),
  }))
  .handler(async ({ data }) => {
    setCookie(LOCALE_COOKIE, data.locale, {
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    })

    return {
      locale: data.locale,
    }
  })

export const getLocalizedServerStatus = createServerFn({ method: "GET" })
  .handler(async () => {
    const resolved = getResolvedLocale()
    activateServerI18n(resolved.locale)

    return {
      locale: resolved.locale,
      localeLabel: getLocaleLabel(resolved.locale),
      handledAt: new Date().toISOString(),
      message: t`Server function confirmed locale ${resolved.locale}.`,
    }
  })
