import { unstable_getHeaders } from "waku/router/server"
import { unstable_redirect } from "waku/router/server"
import { locales } from "../lib/i18n"

export default function IndexPage() {
  const headers = unstable_getHeaders()
  const locale = locales.preferredLocale(headers["accept-language"])

  unstable_redirect(`/${locale}`)
}

export async function getConfig() {
  return {
    render: "dynamic",
  } as const
}
