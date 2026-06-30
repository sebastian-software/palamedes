import { startTransition, StrictMode } from "react"
import { hydrateRoot } from "react-dom/client"
import { HydratedRouter } from "react-router/dom"
import { DEFAULT_LOCALE, LOCALES, syncClientI18n, type Locale } from "~/lib/i18n"

declare global {
  interface Window {
    __PALAMEDES_LOCALE__?: string
  }
}

function bootstrap() {
  const candidate = window.__PALAMEDES_LOCALE__
  const locale: Locale = LOCALES.includes(candidate as Locale)
    ? (candidate as Locale)
    : DEFAULT_LOCALE
  syncClientI18n(locale)

  startTransition(() => {
    hydrateRoot(
      document,
      <StrictMode>
        <HydratedRouter />
      </StrictMode>
    )
  })
}

bootstrap()
