import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { locales } from "@/lib/i18n"

export default async function RootRedirectPage() {
  const headerStore = await headers()
  const locale = locales.preferredLocale(headerStore.get("accept-language"))

  redirect(`/${locale}`)
}
