import { fsRouter } from "waku"
import adapter from "waku/adapters/default"
import { createServerI18nScope } from "@palamedes/runtime/server"
import { createServerI18n, normalizeLocale } from "./lib/i18n"

// Glob keys must keep the `pages/` prefix so fsRouter's default `pagesDir: "pages"`
// matches them. Globbing from `/src` and stripping the leading `/src/` yields
// `pages/[locale].tsx`, `pages/_root.tsx`, ... — the shape fsRouter expects. Using a
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
      const segment = new URL(context.req.raw.url).pathname.split("/").filter(Boolean)[0]
      return serverI18nScope.run(createServerI18n(normalizeLocale(segment)), () => next())
    },
  ],
})
