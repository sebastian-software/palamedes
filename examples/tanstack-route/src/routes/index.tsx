import { createFileRoute } from "@tanstack/react-router"
import { resolveRootRedirect } from "../lib/server-functions"

export const Route = createFileRoute("/")({
  loader: () => resolveRootRedirect(),
  component: () => null,
})
