import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Next.js Route Locale Example",
  description: "Route-driven locale proof for Palamedes on the Next.js App Router",
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui", margin: 0 }}>{children}</body>
    </html>
  )
}
