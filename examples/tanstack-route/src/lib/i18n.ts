import { defineLocaleControls } from "@palamedes/core/locale";

export const LOCALES = ["en", "de", "es"] as const;
export const DEFAULT_LOCALE = "en";
export const LOCALE_COOKIE = "locale";
export type Locale = (typeof LOCALES)[number];

/** Headless locale controls for this demo (route strategy + host map). */
export const locales = defineLocaleControls<Locale>({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  cookies: { locale: LOCALE_COOKIE },
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
