import { createI18n, type CreateI18nOptions } from "@palamedes/core";
import { registerRuntimeMacros } from "@palamedes/runtime/node-macros";
import { createServerCatalogStore } from "@palamedes/runtime/server";

export const locales = ["en", "de", "es"];
export const defaultLocale = "en";

// Written by `pnpm i18n`. `src/` and `dist/` sit at the same depth, so the
// same relative URL works under type stripping and for `tsc` output.
const generated = new URL("../.palamedes/", import.meta.url);
registerRuntimeMacros(new URL("macros.json", generated));

const catalogs = createServerCatalogStore({
  async load({ locale }) {
    if (!locales.includes(locale)) throw new Error(`Unsupported locale: ${locale}`);
    const module = await import(new URL(`catalogs/${locale}.mjs`, generated).href);
    return [module.messages];
  },
});

export async function createNodeI18n(options: CreateI18nOptions & { locale: string }) {
  const i18n = createI18n(options);
  i18n.load(options.locale, await catalogs.load(options.locale));
  return i18n;
}
