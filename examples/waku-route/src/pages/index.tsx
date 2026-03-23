import { getPreferredLocale } from "@palamedes/example-locale-shared"
import { unstable_getHeaders } from "waku/server"
import { unstable_redirect } from "waku/router/server"

export default function IndexPage() {
  const headers = unstable_getHeaders()
  const locale = getPreferredLocale(headers["accept-language"])

  unstable_redirect(`/${locale}`)
}

export async function getConfig() {
  return {
    render: "dynamic",
  } as const
}
