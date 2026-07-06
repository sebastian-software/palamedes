import { createController } from "remix/router"

import {
  getLocaleLabel,
  getRootRedirectLocale,
  getRouteBanner,
  getRouteSwitchLinks,
  normalizeLocale,
  remixI18n,
} from "../i18n.ts"
import { renderHomePage } from "../page.ts"
import { routes } from "../routes.ts"

export default createController(routes, {
  actions: {
    root(context) {
      const locale = getRootRedirectLocale(context.request)
      return new Response(null, {
        status: 302,
        headers: { location: `/${locale}` },
      })
    },

    home(context) {
      return remixI18n.run(
        context,
        ({ locale }) =>
          new Response(
            renderHomePage({
              banner: getRouteBanner(context.request, locale),
              locale,
              localeLabel: getLocaleLabel(normalizeLocale(locale)),
              strategyLabel: "route",
              switchLinks: getRouteSwitchLinks(),
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
  },
})
