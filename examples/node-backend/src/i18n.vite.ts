// The Vite build path. vite.config.ts aliases `./i18n.ts` to this file, so
// application code imports the same `locales`, `defaultLocale`, and
// `createNodeI18n` on both paths; see i18n.ts for the unbundled one.
import { createViteServerI18n } from "@palamedes/vite-plugin/server";

// Must match palamedes.yaml; test/backend.test.mjs fails when they disagree.
export const locales = ["en", "de", "es"] as const;
export const defaultLocale = "en";

/** Each call returns isolated i18n state backed by the shared compiled catalog store. */
export function createNodeI18n(locale: string) {
  return createViteServerI18n({ locale, timeZone: "UTC" });
}
