import { createViteServerI18n } from "@palamedes/vite-plugin/server";
import { createServerI18nScope } from "@palamedes/runtime/server";
import { type Locale, locales } from "./i18n";

export const serverI18nScope =
  createServerI18nScope<Awaited<ReturnType<typeof createViteServerI18n>>>();

export function createServerI18n(locale: Locale) {
  return createViteServerI18n({ locale });
}

export async function createRequestI18n(request: Request) {
  const { locale } = locales.resolve({
    strategy: "subdomain",
    acceptLanguageHeader: request.headers.get("accept-language"),
    requestHost: request.headers.get("host"),
  });
  return createServerI18n(locale);
}
