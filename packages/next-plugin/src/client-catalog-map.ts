/*
 * The server has to name each locale's catalog map before the post-compile
 * step writes it. withPalamedes() therefore picks one token per build and
 * inlines it into the server code, and the map names derive from it. A new
 * build gets a new token, so an immutably cached map never goes stale.
 */

/** Carries the build token from withPalamedes() into Next build workers. */
export const CLIENT_CATALOG_BUILD_ENV = "__PALAMEDES_NEXT_CATALOG_BUILD";

/** Locales are config values; this keeps them to one safe path segment. */
const LOCALE_PATTERN = /^[\w-]+$/u;

/** The file name of one locale's catalog map in `static/palamedes/`. */
export function clientCatalogMapName(locale: string, buildToken: string): string | null {
  return LOCALE_PATTERN.test(locale) ? `catalogs.${locale}.${buildToken}.js` : null;
}
