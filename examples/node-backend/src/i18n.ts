import { createViteServerI18n } from "@palamedes/vite-plugin/server";

export const locales = ["en", "de", "es"] as const;
export const defaultLocale = "en";

/** Each call returns isolated i18n state backed by the shared compiled catalog store. */
export function createNodeI18n(locale: string) {
  return createViteServerI18n({ locale, timeZone: "UTC" });
}
