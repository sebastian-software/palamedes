import { createFileRoute, redirect } from "@tanstack/react-router"
import { RouteLocalePage } from "../components/RouteLocalePage"
import { loadHomePageData } from "../lib/server-functions"
import { normalizeLocale } from "../lib/i18n"

export const Route = createFileRoute("/$locale")({
  loader: async ({ params }) => {
    const locale = normalizeLocale(params.locale)
    if (locale !== params.locale) {
      throw redirect({ to: "/$locale", params: { locale } })
    }

    return loadHomePageData({ data: { locale } })
  },
  component: Home,
})

function Home() {
  const loaderData = Route.useLoaderData()
  return <RouteLocalePage {...loaderData} />
}
