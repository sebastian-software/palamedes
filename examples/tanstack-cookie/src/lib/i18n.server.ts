import { createServerI18nScope } from "@palamedes/runtime/server"
import { createExampleI18n, loadMessages, type Locale } from "./i18n"

export const serverI18nScope = createServerI18nScope<ReturnType<typeof createExampleI18n>>()

export async function createServerI18n(locale: Locale) {
  const i18n = createExampleI18n()
  const messages = await loadMessages(locale)

  i18n.load(locale, messages)
  i18n.activate(locale)
  return i18n
}

export async function activateServerI18n(locale: Locale) {
  return serverI18nScope.activate(await createServerI18n(locale))
}
