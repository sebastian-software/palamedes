export const LOCALES = ["en", "de", "fr"] as const;
export type Locale = (typeof LOCALES)[number];

export function resolveDocumentLocale(): Locale {
  const locale = document.documentElement.lang;
  return LOCALES.includes(locale as Locale) ? (locale as Locale) : "en";
}
