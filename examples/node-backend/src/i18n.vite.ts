// The Vite build path. vite.config.ts redirects `./i18n.ts` to this file, so
// application code imports the same `locales`, `defaultLocale`, and
// `createNodeI18n` on both paths; see i18n.ts for the unbundled one.
import { createBundledServerI18n } from "@palamedes/runtime/server/bundled";

export { defaultLocale, locales } from "./locales.ts";

/** Each call returns isolated i18n state backed by the shared compiled catalog store. */
export function createNodeI18n(locale: string) {
  return createBundledServerI18n({ locale, timeZone: "UTC" });
}
