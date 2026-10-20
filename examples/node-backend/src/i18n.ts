// The unbundled path: plain `node` type stripping and plain `tsc` output.
// Vite builds redirect `./i18n.ts` to i18n.vite.ts instead, so application code
// imports the same `locales`, `defaultLocale`, and `createNodeI18n` on both paths.
import { createI18n } from "@palamedes/core";
import { registerRuntimeMacros } from "@palamedes/runtime/node-macros";
import { createServerCatalogStore } from "@palamedes/runtime/server";
import { locales } from "./locales.ts";

export { defaultLocale, locales } from "./locales.ts";

// Written by `pnpm i18n`. `src/` and `build/` sit at the same depth, so this
// URL works under type stripping and for `tsc` output.
const generated = new URL("../.palamedes/", import.meta.url);
registerRuntimeMacros(new URL("macros.json", generated));

const catalogs = createServerCatalogStore({
  async load({ locale }) {
    if (!(locales as readonly string[]).includes(locale))
      throw new Error(`Unsupported locale: ${locale}`);
    const module = await import(new URL(`catalogs/${locale}.mjs`, generated).href);
    return [module.messages];
  },
});

/** Each call returns isolated i18n state backed by the shared compiled catalog store. */
export async function createNodeI18n(locale: string) {
  const i18n = createI18n({ locale, timeZone: "UTC" });
  i18n.load(locale, await catalogs.load(locale));
  return i18n;
}
