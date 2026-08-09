import { createController } from "remix/router"

import {
  getLocaleLabel,
  normalizeLocale,
  remixI18n,
  resolveLocaleFromRequest,
  serializeLocaleCookie,
} from "../i18n.ts"
import { renderFrameContent, renderFrameDocument } from "../frame-page.tsx"
import { renderHomePage } from "../page.ts"
import { routes } from "../routes.ts"

export default createController(routes, {
  actions: {
    home(context) {
      return remixI18n.run(
        context,
        ({ locale }) =>
          new Response(
            renderHomePage({
              locale,
              localeLabel: getLocaleLabel(normalizeLocale(locale)),
              strategyLabel: "cookie",
            }),
            {
              headers: {
                "content-type": "text/html; charset=utf-8",
                "x-palamedes-locale": locale,
              },
            }
          )
      )
    },

    frameDocument(context) {
      return remixI18n.run(context, ({ locale }) => {
        const normalizedLocale = normalizeLocale(locale)
        return new Response(
          renderFrameDocument({
            locale: normalizedLocale,
            localeLabel: getLocaleLabel(normalizedLocale),
            request: context.request,
          }),
          {
            headers: {
              "content-type": "text/html; charset=utf-8",
              "x-palamedes-locale": normalizedLocale,
            },
          }
        )
      })
    },

    frameLocaleSummary(context) {
      return remixI18n.run(context, ({ locale }) => {
        const normalizedLocale = normalizeLocale(locale)
        return new Response(
          renderFrameContent({
            locale: normalizedLocale,
            localeLabel: getLocaleLabel(normalizedLocale),
          }),
          {
            headers: {
              "content-type": "text/html; charset=utf-8",
              "x-palamedes-locale": normalizedLocale,
            },
          }
        )
      })
    },

    async setLocale(context) {
      const resolved = resolveLocaleFromRequest(context.request)
      const formData = await context.request.formData()
      const locale = normalizeLocale(formData.get("locale") ?? resolved.locale)

      return new Response(null, {
        status: 303,
        headers: {
          location: "/",
          "set-cookie": serializeLocaleCookie(locale),
        },
      })
    },
  },
})
