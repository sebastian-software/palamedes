import { mount, StartClient } from "@solidjs/start/client"

import { locales, syncClientI18n } from "./lib/i18n"

function resolveInitialLocale() {
  return locales.resolve({
    strategy: "tld",
    requestHost: window.location.host,
  }).locale
}

function ClientEntry() {
  syncClientI18n(resolveInitialLocale())
  return <StartClient />
}

export default ClientEntry

mount(() => <ClientEntry />, document.getElementById("app")!)
