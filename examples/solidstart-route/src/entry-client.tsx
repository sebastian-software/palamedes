import { mount, StartClient } from "@solidjs/start/client"

import { DEFAULT_LOCALE, normalizeLocale, syncClientI18n } from "./lib/i18n"

function resolveInitialLocale() {
  const pathLocale = window.location.pathname.split("/").filter(Boolean)[0] ?? DEFAULT_LOCALE
  return normalizeLocale(pathLocale)
}

function ClientEntry() {
  syncClientI18n(resolveInitialLocale())
  return <StartClient />
}

export default ClientEntry

mount(() => <ClientEntry />, document.getElementById("app")!)
