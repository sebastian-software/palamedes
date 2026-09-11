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
export const isLocale = locales.isLocale;
export const normalizeLocale = locales.normalizeLocale;

export function getLocaleLabel(locale: Locale) {
  return locales.label(locale);
}

export function createBanner(headers: Record<string, string | undefined>, locale: Locale) {
  return locales.suggest({
    acceptLanguageHeader: headers["accept-language"],
    cookieHeader: headers.cookie,
    currentLocale: locale,
    pathname: `/${locale}`,
    requestHost: headers.host,
  });
}
