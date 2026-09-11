import { defineLocaleControls } from "@palamedes/core/locale";

export const LOCALES = ["en", "de", "es"] as const;
export const DEFAULT_LOCALE = "en";
export const LOCALE_COOKIE = "locale";
export type Locale = (typeof LOCALES)[number];

/**
 * Headless locale controls for this demo (subdomain strategy). The leftmost DNS
 * label is authoritative for the locale (`de.lvh.me` -> `de`), so no per-locale
 * host map is needed and the same config works across `lvh.me` and production.
 */
export const locales = defineLocaleControls<Locale>({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  cookies: { locale: LOCALE_COOKIE },
  hosts: { mode: "subdomain" },
});

export const LOCALE_LABELS = locales.labels;
export const normalizeLocale = locales.normalizeLocale;

export function getLocaleLabel(locale: Locale): string {
  return locales.label(locale);
}
