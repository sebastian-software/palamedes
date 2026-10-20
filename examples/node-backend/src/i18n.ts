// The same module serves every build path. Without a bundler (plain `node`
// type stripping, plain `tsc` output), @palamedes/runtime/node runs the macros
// from the manifest and catalogs that `pnpm i18n` writes to .palamedes/. A
// build with the Palamedes plugin compiles the macros and bundles the catalogs
// instead, and ignores `generated`.
import { defineNodeI18n } from "@palamedes/runtime/node";

// Must match palamedes.yaml; test/backend.test.mjs fails when they disagree.
export const locales = ["en", "de", "es"] as const;
export const defaultLocale = "en";

// `src/` and `build/` sit at the same depth, so this URL works under type
// stripping and for `tsc` output.
const i18n = defineNodeI18n({ generated: new URL("../.palamedes/", import.meta.url) });

/** Each call returns isolated i18n state backed by the shared compiled catalog store. */
export function createNodeI18n(locale: string) {
  return i18n({ locale, timeZone: "UTC" });
}
