export const LOCALES = ["en", "de"] as const;
export type Locale = (typeof LOCALES)[number];

export function resolveDocumentLocale(): Locale {
  return document.documentElement.lang === "de" ? "de" : "en";
}
