import { createBundledServerI18n } from "@palamedes/runtime/server/bundled";
import { createServerI18nScope } from "@palamedes/runtime/server";
import { type Locale, locales } from "./i18n";

export const serverI18nScope =
  createServerI18nScope<Awaited<ReturnType<typeof createBundledServerI18n>>>();

export function createServerI18n(locale: Locale) {
  return createBundledServerI18n({ locale, timeZone: "Europe/Berlin" });
}

export async function createRequestI18n(request: Request) {
  const { locale } = locales.resolve({
    strategy: "tld",
    acceptLanguageHeader: request.headers.get("accept-language"),
    requestHost: request.headers.get("host"),
  });
  return createServerI18n(locale);
}
