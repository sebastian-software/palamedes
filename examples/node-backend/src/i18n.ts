// The only build-path-specific module. Application code imports `locales`,
// `defaultLocale`, and `createNodeI18n` from here and nothing else about the build.
import { createViteServerI18n } from "@palamedes/vite-plugin/server";

// Must match palamedes.yaml; test/backend.test.mjs fails when they disagree.
export const locales = ["en", "de", "es"] as const;
export const defaultLocale = "en";

/** Each call returns isolated i18n state backed by the shared compiled catalog store. */
export function createNodeI18n(locale: string) {
  return createViteServerI18n({ locale, timeZone: "UTC" });
}
