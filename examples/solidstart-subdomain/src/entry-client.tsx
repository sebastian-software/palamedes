import { mount, StartClient } from "@solidjs/start/client"

import { initializeClientI18n, locales } from "./lib/i18n"

// The host label is authoritative for the server, not for the client: a host
// without a locale label (`localhost`, a bare preview domain) makes the server
// fall back to Accept-Language, which client code cannot read. Re-deriving the
// locale from `window.location` would therefore diverge from the rendered
// document, so the server-rendered `lang` is the source here.
function resolveInitialLocale() {
  const locale = document.documentElement.lang
  if (!locales.isLocale(locale)) {
    throw new Error(
      `Expected a supported server document locale, received ${JSON.stringify(locale)}`
    )
  }

  return locale
}

function ClientEntry() {
  initializeClientI18n(resolveInitialLocale())
  return <StartClient />
}

export default ClientEntry

mount(() => <ClientEntry />, document.getElementById("app")!)
