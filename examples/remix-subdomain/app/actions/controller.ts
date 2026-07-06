import { createController } from "remix/router"

import {
  getLocaleLabel,
  getSubdomainBanner,
  getSubdomainSwitchLinks,
  normalizeLocale,
  remixI18n,
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
  },
})
