import { locales } from "./i18n";
import type { Locale } from "./i18n";

export function resolveLocaleFromRequest(request: Request): Locale {
  return locales.resolve({
    strategy: "tld",
    acceptLanguageHeader: request.headers.get("accept-language"),
    requestHost: request.headers.get("host"),
  }).locale;
}
