import { locales } from "./i18n";
import type { Locale } from "./i18n";

export function resolveLocaleFromRequest(request: Request): Locale {
  return locales.resolve({
    strategy: "cookie",
    acceptLanguageHeader: request.headers.get("accept-language"),
    cookieHeader: request.headers.get("cookie"),
  }).locale;
}
