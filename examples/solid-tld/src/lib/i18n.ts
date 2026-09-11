import { defineLocaleControls } from "@palamedes/core/locale";

export const LOCALES = ["en", "de", "es", "fr"] as const;
export const DEFAULT_LOCALE = "en";
export const LOCALE_COOKIE = "locale";
export type Locale = (typeof LOCALES)[number];

/**
 * Headless locale controls for this demo (TLD strategy). The rightmost DNS
 * label (Top-Level-Domain) is authoritative for locale: `.de` → `de`,
 * `.es` → `es`, `.fr` → `fr`. `.com` maps to `en` via an explicit `tld`
 * override (its label is not a locale code). `defaultTld: "com"`
 * is the switch target for the English locale, so locale switcher links for
 * `en` point at the `.com` host.
 */
export const locales = defineLocaleControls<Locale>({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  cookies: { locale: LOCALE_COOKIE },
  hosts: { mode: "tld", tld: { com: "en" }, defaultTld: "com" },
});

export const LOCALE_LABELS = locales.labels;
export const normalizeLocale = locales.normalizeLocale;

export function getLocaleLabel(locale: Locale): string {
  return locales.label(locale);
}
