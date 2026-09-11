import { locales, normalizeLocale } from "./i18n";
import type { Locale } from "./i18n";

export function resolveLocaleFromRequest(request: Request): Locale {
  const segment = new URL(request.url).pathname.split("/").filter(Boolean)[0];
  return locales.isLocale(segment) ? normalizeLocale(segment) : "en";
}
