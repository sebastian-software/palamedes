import { redirect } from "react-router"
import type { Route } from "./+types/root-redirect"
import { getRootRedirectLocale } from "~/lib/i18n"

export async function loader({ request }: Route.LoaderArgs) {
  const locale = getRootRedirectLocale(request)
  throw redirect(`/${locale}`)
}

export default function RootRedirect() {
  return null
}
