import { createMiddleware } from "@solidjs/start/middleware"
import {
  markServerI18nTestBarrierReached,
  waitForServerI18nTestBarrier,
} from "@palamedes/runtime/server/test"
import { createServerI18n, serverI18nScope } from "./lib/i18n.server"
import { normalizeLocale } from "./lib/i18n"

export default createMiddleware([
  async (event, next) => {
    const request = event.req
    const locale = normalizeLocale(new URL(request.url).pathname.split("/").filter(Boolean)[0])
    return serverI18nScope.run(createServerI18n(locale), async () => {
      await waitForServerI18nTestBarrier(request)
      markServerI18nTestBarrierReached(request, event.res.headers)
      return next()
    })
  },
])
