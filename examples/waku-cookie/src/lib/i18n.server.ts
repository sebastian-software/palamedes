import { createViteServerI18n } from "@palamedes/vite-plugin/server";
import { createServerI18nScope } from "@palamedes/runtime/server";
import { locales, type Locale } from "./i18n";

export const serverI18nScope =
  createServerI18nScope<Awaited<ReturnType<typeof createViteServerI18n>>>();

export function createServerI18n(locale: Locale) {
  return createViteServerI18n({ locale });
}

export async function createRequestI18n(request: Request) {
  const { locale } = locales.resolve({
    strategy: "cookie",
    acceptLanguageHeader: request.headers.get("accept-language"),
    cookieHeader: request.headers.get("cookie"),
  });

  return createServerI18n(locale);
}
