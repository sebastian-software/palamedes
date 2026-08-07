import { createServerI18nScope } from "@palamedes/runtime/server"
import { createExampleI18n, localeMessages, type Locale } from "./i18n"

export const serverI18nScope = createServerI18nScope<ReturnType<typeof createExampleI18n>>()

export function createServerI18n(locale: Locale) {
  const i18n = createExampleI18n()

  i18n.load(locale, localeMessages[locale])
  i18n.activate(locale)
  return i18n
}

export function activateServerI18n(locale: Locale) {
  return serverI18nScope.activate(createServerI18n(locale))
}
