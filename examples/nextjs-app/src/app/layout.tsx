import type { Metadata } from "next"
import { I18nClientProvider } from "@/components/I18nClientProvider"
import { initI18nServer } from "@/lib/i18n.server"

export const metadata: Metadata = {
  title: "Next.js + Lingui (Palamedes)",
  description: "Example using the OXC-based Lingui transformer",
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Server-side: initialize i18n from cookie
  const locale = await initI18nServer()

  return (
    <html lang={locale}>
      <body style={{ fontFamily: "system-ui", margin: 0 }}>
        <I18nClientProvider initialLocale={locale}>
          {children}
        </I18nClientProvider>
      </body>
    </html>
  )
}
