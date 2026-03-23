import { startTransition, StrictMode } from "react"
import { hydrateRoot } from "react-dom/client"
import { HydratedRouter } from "react-router/dom"
import { DEFAULT_LOCALE, syncClientI18n } from "~/lib/i18n"

declare global {
  interface Window {
    __PALAMEDES_LOCALE__?: string
  }
}

async function bootstrap() {
  const locale = window.__PALAMEDES_LOCALE__ ?? DEFAULT_LOCALE
  await syncClientI18n(locale)

  startTransition(() => {
    hydrateRoot(
      document,
      <StrictMode>
        <HydratedRouter />
      </StrictMode>,
    )
  })
}

void bootstrap()
