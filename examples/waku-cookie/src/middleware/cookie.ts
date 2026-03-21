import type { MiddlewareHandler } from "hono"
import { unstable_getContextData as getContextData } from "waku/server"
import { resolveCookieLocale } from "@palamedes/example-locale-shared"

const cookieMiddleware = (): MiddlewareHandler => {
  return async (context, next) => {
    const data = getContextData() as {
      locale?: string
      source?: string
    }
    const resolved = resolveCookieLocale({
      acceptLanguageHeader: context.req.header("accept-language"),
      cookieHeader: context.req.header("cookie"),
    })

    data.locale = resolved.locale
    data.source = resolved.source
    await next()
  }
}

export default cookieMiddleware
