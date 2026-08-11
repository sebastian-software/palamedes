import { createController } from "remix/router"

import {
  getLocaleLabel,
  getSubdomainBanner,
  getSubdomainSwitchLinks,
  locales,
  normalizeLocale,
  remixI18n,
  resolveLocaleRedirect,
} from "../i18n.ts"
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
              banner: getSubdomainBanner(context.request, locale),
              locale,
              localeLabel: getLocaleLabel(normalizeLocale(locale)),
              strategyLabel: "subdomain",
              switchLinks: getSubdomainSwitchLinks(context.request),
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

    async setLocale(context) {
      const formData = await context.request.formData()
      const locale = normalizeLocale(formData.get("locale"))
      const redirect = formData.get("redirect")
      return new Response(null, {
        status: 303,
        headers: {
          location: resolveLocaleRedirect(context.request, locale, redirect, "/"),
          "set-cookie": locales.serializeChoice(locale),
        },
      })
    },
  },
})
