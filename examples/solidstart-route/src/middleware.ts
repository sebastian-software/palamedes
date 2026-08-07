import { createMiddleware } from "@solidjs/start/middleware"
import { waitForServerI18nTestBarrier } from "@palamedes/runtime/server/test"
import { createServerI18n, serverI18nScope } from "./lib/i18n.server"
import { normalizeLocale } from "./lib/i18n"

export default createMiddleware({
  async onRequest(event) {
    const locale = normalizeLocale(
      new URL(event.request.url).pathname.split("/").filter(Boolean)[0]
    )
    serverI18nScope.activate(createServerI18n(locale))
    await waitForServerI18nTestBarrier(event.request)
  },
})
