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
export const isLocale = locales.isLocale;
export const normalizeLocale = locales.normalizeLocale;

export function getLocaleLabel(locale: Locale) {
  return locales.label(locale);
}

// The host label is authoritative for the server, not for the client: a host
// without a locale label (`localhost`, a bare preview domain) makes the server
// fall back to Accept-Language, which client code cannot read. Re-deriving the
// locale from `window.location` would therefore diverge from the rendered
// document, so the page injects the resolved server locale instead.

export function createBanner(headers: Record<string, string | undefined>, locale: Locale) {
  return locales.suggest({
    acceptLanguageHeader: headers["accept-language"],
    cookieHeader: headers.cookie,
    currentLocale: locale,
    pathname: "/",
    requestHost: headers.host,
  });
}
