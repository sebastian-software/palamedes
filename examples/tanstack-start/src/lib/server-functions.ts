import { createServerFn } from "@tanstack/react-start"
import { t } from "@palamedes/core/macro"
import { activateServerI18n } from "./i18n.server"
import { getLocaleLabel, normalizeLocale } from "./i18n"

export const loadHomePageData = createServerFn({ method: "GET" })
  .inputValidator((data: { locale?: string } | undefined) => ({
    locale: normalizeLocale(data?.locale),
  }))
  .handler(async ({ data }) => {
    const locale = normalizeLocale(data.locale)
    activateServerI18n(locale)

    return {
      locale,
      localeLabel: getLocaleLabel(locale),
      renderedAt: new Date().toISOString(),
    }
  })

export const getLocalizedServerStatus = createServerFn({ method: "GET" })
  .inputValidator((data: { locale?: string } | undefined) => ({
    locale: normalizeLocale(data?.locale),
  }))
  .handler(async ({ data }) => {
    const locale = normalizeLocale(data.locale)
    activateServerI18n(locale)

    return {
      locale,
      localeLabel: getLocaleLabel(locale),
      handledAt: new Date().toISOString(),
      message: t`Server function confirmed locale ${locale}.`,
    }
  })
