import { locales, normalizeLocale } from "./i18n";
import type { Locale } from "./i18n";

export function resolveLocaleFromRequest(request: Request): Locale {
  const requestUrl = new URL(request.url);
  const direct = localeFromPathname(requestUrl.pathname);
  if (direct) return direct;

  const explicitHeader = request.headers.get("x-palamedes-locale");
  if (explicitHeader && locales.isLocale(explicitHeader)) {
    return normalizeLocale(explicitHeader);
  }

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      if (refererUrl.origin === requestUrl.origin) {
        const inherited = localeFromPathname(refererUrl.pathname);
        if (inherited) return inherited;
      }
    } catch {
      // Invalid or cross-origin referers do not establish a locale policy.
    }
  }

  return "en";
}

function localeFromPathname(pathname: string): Locale | undefined {
  const segment = pathname.split("/").filter(Boolean)[0];
  return segment && locales.isLocale(segment) ? normalizeLocale(segment) : undefined;
}
