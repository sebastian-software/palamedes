import { fsRouter } from "waku"
import adapter from "waku/adapters/default"
import { createServerI18nScope } from "@palamedes/runtime/server"
import {
  markServerI18nTestBarrierReached,
  waitForServerI18nTestBarrier,
} from "@palamedes/runtime/server/test"
import { createServerI18n, locales } from "./lib/i18n"

// Glob keys must keep the `pages/` prefix so fsRouter's default `pagesDir: "pages"`
// matches them. Globbing from `/src` and stripping the leading `/src/` yields
// `pages/index.tsx`, `pages/_root.tsx`, ... — the shape fsRouter expects. Using a
// `base: "./pages"` glob instead drops that prefix and silently registers no
// routes, which makes every RSC payload 404.
const modules = Object.fromEntries(
  Object.entries(import.meta.glob("/src/pages/**/*.{tsx,ts}")).map(([key, value]) => [
    key.slice("/src/".length),
    value,
  ])
)

const serverI18nScope = createServerI18nScope<ReturnType<typeof createServerI18n>>()

export default adapter(fsRouter(modules), {
  middlewareFns: [
    () => async (context, next) => {
      const request = context.req.raw
      const { locale } = locales.resolve({
        strategy: "tld",
        acceptLanguageHeader: request.headers.get("accept-language"),
        requestHost: request.headers.get("host"),
      })
      return serverI18nScope.run(createServerI18n(locale), async () => {
        await waitForServerI18nTestBarrier(request)
        markServerI18nTestBarrierReached(request, context.res.headers)
        return next()
      })
    },
  ],
})
