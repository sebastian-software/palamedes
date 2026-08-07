import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server"
import {
  markServerI18nTestBarrierReached,
  waitForServerI18nTestBarrier,
} from "@palamedes/runtime/server/test"
import { createServerI18n, serverI18nScope } from "./lib/i18n.server"
import { locales } from "./lib/i18n"

const handler = createStartHandler(defaultStreamHandler)

export default {
  async fetch(request: Request, options?: never) {
    const { locale } = locales.resolve({
      strategy: "cookie",
      acceptLanguageHeader: request.headers.get("accept-language"),
      cookieHeader: request.headers.get("cookie"),
    })
    return serverI18nScope.run(await createServerI18n(locale), async () => {
      await waitForServerI18nTestBarrier(request)
      const response = await handler(request, options)
      markServerI18nTestBarrierReached(request, response.headers)
      return response
    })
  },
}
