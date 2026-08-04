import { mount, StartClient } from "@solidjs/start/client"

import { locales, initializeClientI18n } from "./lib/i18n"

function resolveInitialLocale() {
  return locales.resolve({
    strategy: "subdomain",
    requestHost: window.location.host,
  }).locale
}

function ClientEntry() {
  initializeClientI18n(resolveInitialLocale())
  return <StartClient />
}

export default ClientEntry

mount(() => <ClientEntry />, document.getElementById("app")!)
