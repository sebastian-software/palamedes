import type { Metadata } from "next"
import "@palamedes/example-ui/styles.css"
import { getSubdomainLocale } from "@/lib/i18n.server"

export const metadata: Metadata = {
  title: "Next.js Subdomain Locale Example",
  description: "Subdomain-driven locale proof for Palamedes on the Next.js App Router",
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The locale lives in the request host, so the root layout can resolve it
  // the same way the page does instead of hardcoding a language.
  const { locale } = await getSubdomainLocale()

  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  )
}
