import type { Metadata } from "next"
import "@palamedes/example-ui/styles.css"

export const metadata: Metadata = {
  title: "Next.js Route Locale Example",
  description: "Route-driven locale proof for Palamedes on the Next.js App Router",
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
