import { createExampleI18n, loadMessages, type Locale } from "./i18n"
import { setClientI18n, setServerI18nGetter } from "@palamedes/runtime"

const clientI18n = createExampleI18n()

export async function syncClientI18n(locale: Locale) {
  const messages = await loadMessages(locale)
  clientI18n.load(locale, messages)
  clientI18n.activate(locale)

  if (typeof window === "undefined") {
    setServerI18nGetter(() => clientI18n)
  } else {
    setClientI18n(clientI18n)
  }

  return clientI18n
}
