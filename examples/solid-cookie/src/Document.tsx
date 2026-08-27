import type { ParentProps } from "solid-js"
import { getRequestEvent, HydrationScript } from "@solidjs/web"
import { initializeClientI18n, locales, type Locale } from "./lib/i18n"
import { resolveCookieLocale } from "./lib/server"

function resolveDocumentLocale(): Locale {
  if (typeof document !== "undefined") {
    const locale = document.documentElement.lang
    if (!locales.isLocale(locale)) {
      throw new Error(
        `Expected a supported server document locale, received ${JSON.stringify(locale)}`
      )
    }
    return locale
  }

  return resolveCookieLocale(getRequestEvent()?.request).locale
}

export default function Document(props: ParentProps) {
  const locale = resolveDocumentLocale()
  initializeClientI18n(locale)

  return (
    <html lang={locale}>
      <head>
        <meta charset="utf-8" />
        <meta content="width=device-width, initial-scale=1" name="viewport" />
        <HydrationScript />
      </head>
      <body>{props.children}</body>
    </html>
  )
}
