import { query } from "@solidjs/router"
import { setCookie } from "@solidjs/start/http"
import { getRequestEvent } from "solid-js/web"
import { t } from "@palamedes/core/macro"
import { activateServerI18n } from "./i18n.server"
import { getLocaleLabel, LOCALE_COOKIE, type Locale, locales } from "./i18n"

export function resolveCookieLocale(request: Request | undefined) {
  return locales.resolve({
    strategy: "cookie",
    acceptLanguageHeader: request?.headers.get("accept-language"),
    cookieHeader: request?.headers.get("cookie"),
  })
}

export const loadHomePageData = query(async () => {
  "use server"

  const event = getRequestEvent()
  const resolved = resolveCookieLocale(event?.request)

  await activateServerI18n(resolved.locale)

  return {
    locale: resolved.locale,
    localeLabel: getLocaleLabel(resolved.locale),
    renderedAt: new Date().toISOString(),
    source: resolved.source,
  }
}, "solidstart-cookie:home")

export async function setLocaleCookie(locale: Locale) {
  "use server"

  setCookie(LOCALE_COOKIE, locales.normalizeLocale(locale), {
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
    sameSite: "lax",
  })
}

export const getLocalizedServerStatus = query(async () => {
  "use server"

  const event = getRequestEvent()
  const resolved = resolveCookieLocale(event?.request)

  await activateServerI18n(resolved.locale)

  return {
    locale: resolved.locale,
    localeLabel: getLocaleLabel(resolved.locale),
    handledAt: new Date().toISOString(),
    message: t`Server query confirmed locale ${resolved.locale}.`,
  }
}, "solidstart-cookie:status")
