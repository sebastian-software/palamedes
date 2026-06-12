import { setServerI18nGetter } from "@palamedes/runtime"
import { createExampleI18n, loadMessages, type Locale } from "./i18n"

export async function activateServerI18n(locale: Locale) {
  const i18n = createExampleI18n()
  const messages = await loadMessages(locale)

  i18n.load(locale, messages)
  i18n.activate(locale)
  setServerI18nGetter(() => i18n)

  return i18n
}
