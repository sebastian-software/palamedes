export const locales = ["en", "de", "fr", "es"] as const;
export type Locale = (typeof locales)[number];
export const timeZone = "Europe/Berlin";

export function resolveLocale(value: unknown): Locale {
  return locales.find((locale) => locale === value) ?? "en";
}
