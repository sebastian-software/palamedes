import { query } from "@solidjs/router"
import { getRequestEvent } from "solid-js/web"
import { t } from "@palamedes/core/macro"
import {
  createRouteLocaleBanner,
  normalizeLocale as normalizeSharedLocale,
} from "@palamedes/example-locale-shared"
import { activateServerI18n } from "./i18n.server"
import { getLocaleLabel, normalizeLocale, ROUTE_HOSTS } from "./i18n"

export const loadRoutePageData = query(async (routeLocale: string) => {
  "use server"

  const event = getRequestEvent()
  const locale = normalizeSharedLocale(routeLocale)
  activateServerI18n(locale)

  const requestUrl = event ? new URL(event.request.url) : new URL(`http://127.0.0.1/${locale}`)

  return {
    banner: createRouteLocaleBanner({
      acceptLanguageHeader: event?.request.headers.get("accept-language"),
      currentLocale: locale,
      hostConfig: ROUTE_HOSTS,
      pathname: requestUrl.pathname,
      requestHost: event?.request.headers.get("host"),
      search: requestUrl.search,
    }),
    locale,
    localeLabel: getLocaleLabel(locale),
    renderedAt: new Date().toISOString(),
  }
}, "solidstart-route:home")

export const getLocalizedServerStatus = query(async (routeLocale: string) => {
  "use server"

  const locale = normalizeLocale(routeLocale)
  activateServerI18n(locale)

  return {
    locale,
    localeLabel: getLocaleLabel(locale),
    handledAt: new Date().toISOString(),
    message: t`Server query confirmed locale ${locale}.`,
  }
}, "solidstart-route:status")
