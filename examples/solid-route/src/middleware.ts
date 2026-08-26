import type { FetchMiddleware } from "@solidjs/web"
import {
  markServerI18nTestBarrierReached,
  waitForServerI18nTestBarrier,
} from "@palamedes/runtime/server/test"
import { createServerI18n, serverI18nScope } from "./lib/i18n.server"
import { DEFAULT_LOCALE, normalizeLocale } from "./lib/i18n"

export default [
  async (request: Request, next: () => Promise<Response>) => {
    const url = new URL(request.url)
    if (request.method === "GET" && url.pathname === "/") {
      return Response.redirect(new URL(`/${DEFAULT_LOCALE}`, url), 302)
    }

    const locale = normalizeLocale(url.pathname.split("/").filter(Boolean)[0])
    return serverI18nScope.run(createServerI18n(locale), async () => {
      await waitForServerI18nTestBarrier(request)
      const response = await next()
      markServerI18nTestBarrierReached(request, response.headers)
      return response
    })
  },
] satisfies FetchMiddleware[]
