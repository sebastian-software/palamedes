import { createServerFn } from "@tanstack/react-start"
import { getRequestHeader, setCookie } from "@tanstack/react-start/server"
import { t } from "@palamedes/core/macro"
import { getLocaleLabel, LOCALE_COOKIE, locales, normalizeLocale } from "./i18n"
import {
  asynchronousServerFunctionMessage,
  synchronousServerFunctionMessage,
} from "./server-function-helpers.server"
import { crossModuleServerFunctionMessage } from "./server-function-cross-module.server"

function getResolvedLocale() {
  return locales.resolve({
    strategy: "cookie",
    acceptLanguageHeader: getRequestHeader("accept-language"),
    cookieHeader: getRequestHeader("cookie"),
  })
}

export const loadDocumentLocale = createServerFn({ method: "GET" }).handler(
  () => getResolvedLocale().locale
)

export const loadHomePageData = createServerFn({ method: "GET" }).handler(async () => {
  const resolved = getResolvedLocale()

  return {
    locale: resolved.locale,
    localeLabel: getLocaleLabel(resolved.locale),
    renderedAt: new Date().toISOString(),
    source: resolved.source,
  }
})

export const setLocaleCookie = createServerFn({ method: "POST" })
  .validator((data: { locale?: string } | undefined) => ({
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

export const getLocalizedServerStatus = createServerFn({ method: "GET" }).handler(async () => {
  const resolved = getResolvedLocale()

  return {
    locale: resolved.locale,
    localeLabel: getLocaleLabel(resolved.locale),
    handledAt: new Date().toISOString(),
    messages: {
      asynchronous: await asynchronousServerFunctionMessage(),
      crossModule: crossModuleServerFunctionMessage(),
      direct: t`Server function confirmed locale ${resolved.locale}.`,
      synchronous: synchronousServerFunctionMessage(),
    },
  }
})
