import { mount, StartClient } from "@solidjs/start/client"

import { DEFAULT_LOCALE, LOCALE_COOKIE, normalizeLocale, syncClientI18n } from "./lib/i18n"

function resolveInitialLocale() {
  const cookieValue = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${LOCALE_COOKIE}=`))
    ?.slice(`${LOCALE_COOKIE}=`.length)

  if (cookieValue) {
    return normalizeLocale(cookieValue)
  }

  const preferredLanguage = navigator.language.split("-")[0] ?? DEFAULT_LOCALE
  return normalizeLocale(preferredLanguage)
}

function ClientEntry() {
  void syncClientI18n(resolveInitialLocale())
  return <StartClient />
}

export default ClientEntry

mount(() => <ClientEntry />, document.getElementById("app")!)
