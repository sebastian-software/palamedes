import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server"
import {
  markServerI18nTestBarrierReached,
  waitForServerI18nTestBarrier,
} from "@palamedes/runtime/server/test"
import { createServerI18n, serverI18nScope } from "./lib/i18n.server"
import { locales } from "./lib/i18n"

const handler = createStartHandler(defaultStreamHandler)

export default {
  fetch(request: Request, options?: never) {
    const { locale } = locales.resolve({
      strategy: "subdomain",
      acceptLanguageHeader: request.headers.get("accept-language"),
      requestHost: request.headers.get("host"),
    })
    return serverI18nScope.run(createServerI18n(locale), async () => {
      await waitForServerI18nTestBarrier(request)
      const response = await handler(request, options)
      markServerI18nTestBarrierReached(request, response.headers)
      return response
    })
  },
}
