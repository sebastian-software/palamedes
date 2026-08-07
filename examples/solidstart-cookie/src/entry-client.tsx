import { mount, StartClient } from "@solidjs/start/client"

import { initializeClientI18n, locales } from "./lib/i18n"

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
  void initializeClientI18n(resolveInitialLocale())
  return <StartClient />
}

export default ClientEntry

mount(() => <ClientEntry />, document.getElementById("app")!)
