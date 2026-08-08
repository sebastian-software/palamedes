import { createServerI18n, locales } from "./i18n"

export async function createRequestI18n(request: Request) {
  const { locale } = locales.resolve({
    strategy: "cookie",
    acceptLanguageHeader: request.headers.get("accept-language"),
    cookieHeader: request.headers.get("cookie"),
  })

  return await createServerI18n(locale)
}
