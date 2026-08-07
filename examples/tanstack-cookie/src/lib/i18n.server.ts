import { createServerI18nScope } from "@palamedes/runtime/server"
import { createExampleI18n, loadMessages, locales, type Locale } from "./i18n"

export const serverI18nScope = createServerI18nScope<ReturnType<typeof createExampleI18n>>()

export async function createServerI18n(locale: Locale) {
  const i18n = createExampleI18n()
  const messages = await loadMessages(locale)

  i18n.load(locale, messages)
  i18n.activate(locale)
  return i18n
}

export async function createServerI18nFromRequest(request: Request) {
  const { locale } = locales.resolve({
    strategy: "cookie",
    acceptLanguageHeader: request.headers.get("accept-language"),
    cookieHeader: request.headers.get("cookie"),
  })

  return await createServerI18n(locale)
}
