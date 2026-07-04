import { setServerI18nGetter } from "@palamedes/runtime"
import { createExampleI18n, localeMessages, type Locale } from "./i18n"

export function activateServerI18n(locale: Locale) {
  const i18n = createExampleI18n()

  i18n.load(locale, localeMessages[locale])
  i18n.activate(locale)
  setServerI18nGetter(() => i18n)

  return i18n
}
