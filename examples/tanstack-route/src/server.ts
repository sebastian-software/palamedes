import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server"
import { createServerI18n, serverI18nScope } from "./lib/i18n.server"
import { normalizeLocale } from "./lib/i18n"

const handler = createStartHandler(defaultStreamHandler)

export default {
  fetch(request: Request, options?: never) {
    const segment = new URL(request.url).pathname.split("/").filter(Boolean)[0]
    return serverI18nScope.run(createServerI18n(normalizeLocale(segment)), () =>
      handler(request, options)
    )
  },
}
