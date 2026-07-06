import { createController } from "remix/router"

import { remixI18n } from "../i18n.ts"
import { renderHomePage } from "../page.ts"
import { routes } from "../routes.ts"

export default createController(routes, {
  actions: {
    home(context) {
      return remixI18n.run(context.request, (i18n) => {
        return new Response(renderHomePage(i18n.locale), {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "x-palamedes-locale": i18n.locale ?? "",
          },
        })
      })
    },
  },
})
