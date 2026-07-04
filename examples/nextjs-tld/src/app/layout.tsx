import type { Metadata } from "next"
import "@palamedes/example-ui/styles.css"

export const metadata: Metadata = {
  title: "Next.js TLD Locale Example",
  description: "Top-level-domain-driven locale proof for Palamedes on the Next.js App Router",
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
