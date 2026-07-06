import { createController } from "remix/router"

import {
  getLocaleLabel,
  normalizeLocale,
  remixI18n,
  resolveLocaleFromRequest,
  serializeLocaleCookie,
} from "../i18n.ts"
import { renderHomePage } from "../page.ts"
import { routes } from "../routes.ts"

export default createController(routes, {
  actions: {
    home(context) {
      return remixI18n.run(
        context.request,
        (i18n) =>
          new Response(renderHomePage(i18n.locale, getLocaleLabel(normalizeLocale(i18n.locale))), {
            headers: {
              "content-type": "text/html; charset=utf-8",
              "x-palamedes-locale": i18n.locale ?? "",
            },
          })
      )
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
