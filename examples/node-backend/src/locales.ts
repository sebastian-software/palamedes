// Shared by both i18n variants. Must match palamedes.yaml; test/backend.test.mjs
// fails when they disagree.
export const locales = ["en", "de", "es"] as const;
export const defaultLocale = "en";
