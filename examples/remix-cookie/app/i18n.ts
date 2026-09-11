import path from "node:path";

import type { CompiledCatalogMessages } from "@palamedes/core/compiled";
import { defineLocaleControls, type LocaleSource } from "@palamedes/core/locale";
import { createRemixI18nServer } from "@palamedes/remix/server";

import { messages as deMessages } from "./locales/de.po";
import { messages as enMessages } from "./locales/en.po";
import { messages as esMessages } from "./locales/es.po";

export const LOCALES = ["en", "de", "es"] as const;
export const DEFAULT_LOCALE = "en";
export const LOCALE_COOKIE = "locale";

export type Locale = (typeof LOCALES)[number];
export type ResolvedLocale = {
  locale: Locale;
  source: LocaleSource;
};

export const locales = defineLocaleControls<Locale>({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  cookies: { locale: LOCALE_COOKIE },
});

export const LOCALE_LABELS = locales.labels;
export const normalizeLocale = locales.normalizeLocale;

const CATALOGS: Record<Locale, CompiledCatalogMessages> = {
  en: enMessages,
  de: deMessages,
  es: esMessages,
};

const EXAMPLE_ROOT = path.resolve(import.meta.dirname, "..");

export function getLocaleLabel(locale: Locale): string {
  return locales.label(locale);
}

export function loadMessages(locale: Locale): CompiledCatalogMessages {
  return CATALOGS[locale];
}

export const remixI18n = createRemixI18nServer({
  locales,
  strategy: "cookie",
  loadMessages,
  catalogAssets: {
    config: {
      rootDir: EXAMPLE_ROOT,
      locales: [...LOCALES],
      sourceLocale: DEFAULT_LOCALE,
      catalogs: [{ path: "app/locales/{locale}", include: ["app"] }],
    },
    resolvePath: (locale) => path.join(EXAMPLE_ROOT, "app", "locales", `${locale}.po`),
  },
  cookieName: LOCALE_COOKIE,
});

export function resolveLocaleFromRequest(request: Request): ResolvedLocale {
  return remixI18n.resolveLocale(request);
}

export function serializeLocaleCookie(locale: Locale): string {
  return remixI18n.serializeLocaleCookie(locale);
}
