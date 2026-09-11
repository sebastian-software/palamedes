import { defineLocaleControls } from "@palamedes/core/locale";

export const LOCALES = ["en", "de", "es"] as const;
export const DEFAULT_LOCALE = "en";
export const LOCALE_COOKIE = "locale";
export type Locale = (typeof LOCALES)[number];

/** Headless locale controls for this demo (cookie strategy). */
export const locales = defineLocaleControls<Locale>({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  cookies: { locale: LOCALE_COOKIE },
});

export const LOCALE_LABELS = locales.labels;

export function getLocaleLabel(locale: Locale) {
  return locales.label(locale);
}

export function resolveCookieLocale(headers: Record<string, string | undefined>) {
  return locales.resolve({
    strategy: "cookie",
    acceptLanguageHeader: headers["accept-language"],
    cookieHeader: headers.cookie,
  });
}
