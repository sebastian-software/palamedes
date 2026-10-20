// The Vite build path. vite.config.ts redirects `./i18n.ts` to this file, so
// application code imports the same `locales`, `defaultLocale`, and
// `createNodeI18n` on both paths; see i18n.ts for the unbundled one.
import { createViteServerI18n } from "@palamedes/vite-plugin/server";

export { defaultLocale, locales } from "./locales.ts";

/** Each call returns isolated i18n state backed by the shared compiled catalog store. */
export function createNodeI18n(locale: string) {
  return createViteServerI18n({ locale, timeZone: "UTC" });
}
