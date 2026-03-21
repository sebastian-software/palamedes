import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { getPreferredLocale } from "@palamedes/example-locale-shared"

export default async function RootRedirectPage() {
  const headerStore = await headers()
  const locale = getPreferredLocale(headerStore.get("accept-language"))

  redirect(`/${locale}`)
}
