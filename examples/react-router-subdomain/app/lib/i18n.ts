import { defineLocaleControls } from "@palamedes/core/locale";

export const LOCALES = ["en", "de", "es"] as const;
export const DEFAULT_LOCALE = "en";
export type Locale = (typeof LOCALES)[number];

/**
 * Headless locale controls for this demo (subdomain strategy). The leftmost DNS
 * label is authoritative for the locale (`de.lvh.me` -> `de`), so no per-locale
 * host map is needed and the same config works across `lvh.me` and production.
 */
export const locales = defineLocaleControls<Locale>({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  hosts: { mode: "subdomain" },
});

export const LOCALE_LABELS = locales.labels;
export const normalizeLocale = locales.normalizeLocale;

export function getLocaleLabel(locale: Locale): string {
  return locales.label(locale);
}

/**
 * Resolve the authoritative locale from the request `Host` header. The subdomain
 * strategy reads the leftmost DNS label (`de.lvh.me` -> `de`) and falls back to
 * the default locale when the label is missing or unknown. The banner surfaces
 * an Accept-Language hint when the visitor's preferred locale differs from the
 * one the host is currently serving.
 */
export function resolveSubdomainLocale(request: Request) {
  const host = request.headers.get("host");
  const acceptLanguageHeader = request.headers.get("accept-language");

  const resolved = locales.resolve({
    strategy: "subdomain",
    acceptLanguageHeader,
    requestHost: host,
  });

  return {
    banner: locales.suggest({
      acceptLanguageHeader,
      cookieHeader: request.headers.get("cookie"),
      currentLocale: resolved.locale,
      pathname: "/",
      requestHost: host,
    }),
    host,
    locale: resolved.locale,
    source: resolved.source,
  };
}

export function resolveLocaleFromRequest(request: Request): Locale {
  return resolveSubdomainLocale(request).locale;
}
