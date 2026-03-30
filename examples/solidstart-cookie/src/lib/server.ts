import { query } from "@solidjs/router"
import { getRequestEvent } from "solid-js/web"
import { t } from "@palamedes/core/macro"
import { resolveCookieLocale } from "@palamedes/example-locale-shared"
import { activateServerI18n } from "./i18n.server"
import { getLocaleLabel } from "./i18n"

export const loadHomePageData = query(async () => {
  "use server"

  const event = getRequestEvent()
  const resolved = resolveCookieLocale({
    acceptLanguageHeader: event?.request.headers.get("accept-language"),
    cookieHeader: event?.request.headers.get("cookie"),
  })

  activateServerI18n(resolved.locale)

  return {
    locale: resolved.locale,
    localeLabel: getLocaleLabel(resolved.locale),
    renderedAt: new Date().toISOString(),
    source: resolved.source,
  }
}, "solidstart-cookie:home")

export const getLocalizedServerStatus = query(async () => {
  "use server"

  const event = getRequestEvent()
  const resolved = resolveCookieLocale({
    acceptLanguageHeader: event?.request.headers.get("accept-language"),
    cookieHeader: event?.request.headers.get("cookie"),
  })

  activateServerI18n(resolved.locale)

  return {
    locale: resolved.locale,
    localeLabel: getLocaleLabel(resolved.locale),
    handledAt: new Date().toISOString(),
    message: t`Server query confirmed locale ${resolved.locale}.`,
  }
}, "solidstart-cookie:status")
