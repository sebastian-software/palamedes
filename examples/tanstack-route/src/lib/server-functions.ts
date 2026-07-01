import { createServerFn } from "@tanstack/react-start"
import { getRequestHeader } from "@tanstack/react-start/server"
import { redirect } from "@tanstack/react-router"
import { t } from "@palamedes/core/macro"
import {
  createRouteLocaleBanner,
  getPreferredLocale,
  normalizeLocale as normalizeSharedLocale,
  parseChoiceLocale,
} from "@palamedes/example-locale-shared"
import { activateServerI18n } from "./i18n.server"
import { getLocaleLabel, ROUTE_HOSTS, normalizeLocale } from "./i18n"

export const resolveRootRedirect = createServerFn({ method: "GET" }).handler(async () => {
  const locale = getPreferredLocale(getRequestHeader("accept-language"))
  throw redirect({
    to: "/$locale",
    params: { locale },
  })
})

export const loadHomePageData = createServerFn({ method: "GET" })
  .validator((data: { locale?: string } | undefined) => ({
    locale: normalizeLocale(data?.locale),
  }))
  .handler(async ({ data }) => {
    const locale = normalizeSharedLocale(data.locale)
    activateServerI18n(locale)

    return {
      banner: createRouteLocaleBanner({
        acceptLanguageHeader: getRequestHeader("accept-language"),
        choiceLocale: parseChoiceLocale(getRequestHeader("cookie")),
        currentLocale: locale,
        hostConfig: ROUTE_HOSTS,
        pathname: `/${locale}`,
        requestHost: getRequestHeader("host"),
      }),
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
    const locale = normalizeSharedLocale(data.locale)
    activateServerI18n(locale)

    return {
      locale,
      localeLabel: getLocaleLabel(locale),
      handledAt: new Date().toISOString(),
      message: t`Server function confirmed locale ${locale}.`,
    }
  })
