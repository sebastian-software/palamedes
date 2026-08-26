import { query } from "@solidjs/router"
import { getRequestEvent } from "@solidjs/web"
import { t } from "@palamedes/core/macro"
import { activateServerI18n } from "./i18n.server"
import { getLocaleLabel, locales } from "./i18n"

/**
 * Resolve the request locale authoritatively from the TLD
 * (e.g. `example.de` → `de`, `example.fr` → `fr`). Server functions run on
 * the same host the browser requested, so the `Host` header is available here
 * too.
 */
export function resolveHostLocale(request: Request | undefined) {
  const requestHost = request?.headers.get("host") ?? null
  const acceptLanguageHeader = request?.headers.get("accept-language") ?? null
  const { locale } = locales.resolve({
    strategy: "tld",
    acceptLanguageHeader,
    requestHost,
  })

  return { acceptLanguageHeader, locale, requestHost }
}

export const loadHomePageData = query(async () => {
  "use server"

  const event = getRequestEvent()
  const { acceptLanguageHeader, locale, requestHost } = resolveHostLocale(event?.request)
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
}, "solid-tld:home")

export const getLocalizedServerStatus = query(async () => {
  "use server"

  const { locale } = resolveHostLocale(getRequestEvent()?.request)
  activateServerI18n(locale)

  return {
    locale,
    localeLabel: getLocaleLabel(locale),
    handledAt: new Date().toISOString(),
    message: t`Server query confirmed locale ${locale}.`,
  }
}, "solid-tld:status")
