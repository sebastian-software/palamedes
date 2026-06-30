import type { Metadata } from "next"
import "@palamedes/example-ui/styles.css"
import { initI18nServer } from "@/lib/i18n.server"

export const metadata: Metadata = {
  title: "Next.js + Palamedes",
  description: "Example using the OXC-based Palamedes transformer",
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Server-side: initialize i18n from cookie
  const locale = await initI18nServer()

  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  )
}
