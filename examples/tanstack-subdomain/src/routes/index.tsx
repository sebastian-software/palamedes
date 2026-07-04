import { createFileRoute } from "@tanstack/react-router"
import { RouteLocalePage } from "../components/RouteLocalePage"
import { loadHomePageData } from "../lib/server-functions"

export const Route = createFileRoute("/")({
  loader: () => loadHomePageData(),
  component: Home,
})

function Home() {
  const loaderData = Route.useLoaderData()
  return <RouteLocalePage {...loaderData} />
}
