import type { ReactNode } from "react"
import { unstable_getRequest } from "waku/router/server"
import "@palamedes/example-ui/styles.css"
import { normalizeLocale } from "../lib/i18n"

export default function Root({ children }: { children: ReactNode }) {
  const pathname = new URL(unstable_getRequest().url).pathname
  const locale = normalizeLocale(pathname.split("/").filter(Boolean)[0])

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

export async function getConfig() {
  return {
    render: "dynamic",
  } as const
}
