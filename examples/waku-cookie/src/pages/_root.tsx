import type { ReactNode } from "react"
import "@palamedes/example-ui/styles.css"
import { unstable_getHeaders } from "waku/router/server"
import { resolveCookieLocale } from "../lib/i18n"

export default async function Root({ children }: { children: ReactNode }) {
  const { locale } = resolveCookieLocale(unstable_getHeaders())

  return (
    <html lang={locale}>
      <head>
        <meta charSet="utf-8" />
        <meta content="width=device-width, initial-scale=1" name="viewport" />
      </head>
      <body>{children}</body>
    </html>
  )
}
