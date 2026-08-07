import { createMiddleware } from "@solidjs/start/middleware"
import { waitForServerI18nTestBarrier } from "@palamedes/runtime/server/test"
import { createServerI18n, serverI18nScope } from "./lib/i18n.server"
import { locales } from "./lib/i18n"

export default createMiddleware({
  async onRequest(event) {
    const { locale } = locales.resolve({
      strategy: "subdomain",
      acceptLanguageHeader: event.request.headers.get("accept-language"),
      requestHost: event.request.headers.get("host"),
    })
    serverI18nScope.activate(createServerI18n(locale))
    await waitForServerI18nTestBarrier(event.request)
  },
})
