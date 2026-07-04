import { query } from "@solidjs/router"
import { getRequestEvent } from "solid-js/web"
import { t } from "@palamedes/core/macro"
import { activateServerI18n } from "./i18n.server"
import { getLocaleLabel, locales } from "./i18n"

/**
 * Resolve the request locale authoritatively from the host label
 * (`de.lvh.me` -> `de`). Server functions run on the same host the browser
 * requested, so the `Host` header is available here too.
 */
function resolveHostLocale() {
  const event = getRequestEvent()
  const requestHost = event?.request.headers.get("host") ?? null
  const acceptLanguageHeader = event?.request.headers.get("accept-language") ?? null
  const { locale } = locales.resolve({
    strategy: "subdomain",
    acceptLanguageHeader,
    requestHost,
  })

  return { acceptLanguageHeader, event, locale, requestHost }
}

export const loadHomePageData = query(async () => {
  "use server"

  const { acceptLanguageHeader, event, locale, requestHost } = resolveHostLocale()
  activateServerI18n(locale)

  return {
    banner: locales.suggest({
      acceptLanguageHeader,
      cookieHeader: event?.request.headers.get("cookie"),
      currentLocale: locale,
      pathname: "/",
      requestHost,
    }),
    host: requestHost,
    locale,
    localeLabel: getLocaleLabel(locale),
    renderedAt: new Date().toISOString(),
  }
}, "solidstart-subdomain:home")

export const getLocalizedServerStatus = query(async () => {
  "use server"

  const { locale } = resolveHostLocale()
  activateServerI18n(locale)

  return {
    locale,
    localeLabel: getLocaleLabel(locale),
    handledAt: new Date().toISOString(),
    message: t`Server query confirmed locale ${locale}.`,
  }
}, "solidstart-subdomain:status")
