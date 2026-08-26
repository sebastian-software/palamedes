import type { FetchMiddleware } from "@solidjs/web"
import {
  markServerI18nTestBarrierReached,
  waitForServerI18nTestBarrier,
} from "@palamedes/runtime/server/test"
import { createServerI18n, serverI18nScope } from "./lib/i18n.server"
import { normalizeLocale } from "./lib/i18n"

export default [
  async (request: Request, next: () => Promise<Response>) => {
    const locale = normalizeLocale(new URL(request.url).pathname.split("/").filter(Boolean)[0])
    return serverI18nScope.run(createServerI18n(locale), async () => {
      await waitForServerI18nTestBarrier(request)
      const response = await next()
      markServerI18nTestBarrierReached(request, response.headers)
      return response
    })
  },
] satisfies FetchMiddleware[]
