import adapter from "waku/adapters/default"
import { Slot } from "waku/minimal/client"
import App from "./components/App"
import { getInitialRouteLocale, getRouteBanner, normalizeLocale, type Locale } from "./lib/i18n"

function getLocaleFromPath(pathname: string): Locale | null {
  const match = pathname.match(/^\/(en|de|es)\/?$/)
  return match?.[1] ? normalizeLocale(match[1]) : null
}

export default adapter({
  handleRequest: async (input, { renderRsc, renderHtml }) => {
    if (input.type === "function") {
      return renderRsc({
        _value: await input.fn(...input.args),
      })
    }

    if (input.type === "custom" && input.pathname === "/") {
      const locale = getInitialRouteLocale(input.req)
      return Response.redirect(new URL(`/${locale}`, input.req.url), 302)
    }

    const locale = getLocaleFromPath(input.pathname)
    if (!locale) {
      return null
    }

    const app = <App banner={getRouteBanner(input.req, locale)} locale={locale} />

    if (input.type === "component") {
      return renderRsc({ App: app })
    }

    if (input.type === "action" || input.type === "custom") {
      const formState = input.type === "action" ? await input.fn() : undefined
      return renderHtml(
        await renderRsc({ App: app }),
        <Slot id="App" />,
        {
          formState,
          rscPath: input.pathname,
        },
      )
    }
  },
  handleBuild: async () => {},
})
