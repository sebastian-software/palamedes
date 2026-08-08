import { fsRouter } from "waku"
import adapter from "waku/adapters/default"
import {
  markServerI18nTestBarrierReached,
  waitForServerI18nTestBarrier,
} from "@palamedes/runtime/server/test"

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

export default adapter(fsRouter(modules), {
  middlewareFns: [
    () => async (context, next) => {
      const request = context.req.raw
      await waitForServerI18nTestBarrier(request)
      markServerI18nTestBarrierReached(request, context.res.headers)
      return await next()
    },
  ],
})
