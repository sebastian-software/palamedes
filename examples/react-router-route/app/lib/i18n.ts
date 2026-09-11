import { defineLocaleControls } from "@palamedes/core/locale";

export const LOCALES = ["en", "de", "es"] as const;
export const DEFAULT_LOCALE = "en";
export type Locale = (typeof LOCALES)[number];

/** Headless locale controls for this demo (route strategy + host map). */
export const locales = defineLocaleControls<Locale>({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  hosts: {
    locales: {
      en: "en.lvh.me",
      de: "de.lvh.me",
      es: "es.lvh.me",
    },
  },
});

export const LOCALE_LABELS = locales.labels;
export const normalizeLocale = locales.normalizeLocale;

export function getLocaleLabel(locale: Locale): string {
  return locales.label(locale);
}

export function getRootRedirectLocale(request: Request) {
  return locales.preferredLocale(request.headers.get("accept-language"));
}

export function resolveLocaleFromRequest(request: Request): Locale {
  const pathname = new URL(request.url).pathname;
  // Single Fetch revalidates a route through `/<path>.data`, so the locale
  // segment arrives suffixed on every client-side loader call. Without stripping
  // it the root loader falls through to Accept-Language and the document lang
  // flips away from the locale the page was served with.
  const segment = pathname
    .split("/")
    .filter(Boolean)[0]
    ?.replace(/\.data$/u, "");

  if (LOCALES.includes(segment as Locale)) {
    return segment as Locale;
  }

  return getRootRedirectLocale(request);
}

export function getRouteBanner(request: Request, locale: Locale) {
  return locales.suggest({
    acceptLanguageHeader: request.headers.get("accept-language"),
    cookieHeader: request.headers.get("cookie"),
    currentLocale: locale,
    pathname: `/${locale}`,
    requestHost: request.headers.get("host"),
  });
}
