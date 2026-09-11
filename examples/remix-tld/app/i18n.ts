import type { CompiledCatalogMessages } from "@palamedes/core/compiled";
import { defineLocaleControls, type LocaleSource } from "@palamedes/core/locale";
import { createPalamedesRemixCatalogAssetRegistry } from "@palamedes/remix";
import { createRemixI18nServer } from "@palamedes/remix/server";
import { messages as deMessages } from "./locales/de.po";
import { messages as enMessages } from "./locales/en.po";
import { messages as esMessages } from "./locales/es.po";
import { messages as frMessages } from "./locales/fr.po";

export const LOCALES = ["en", "de", "es", "fr"] as const;
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
  cookies: { choice: LOCALE_COOKIE },
  hosts: { mode: "tld", tld: { com: "en" }, defaultTld: "com" },
});

export const LOCALE_LABELS = locales.labels;
export const normalizeLocale = locales.normalizeLocale;

const EXAMPLE_ROOT = path.resolve(import.meta.dirname, "..");
export const catalogAssetRegistry = createPalamedesRemixCatalogAssetRegistry({
  cwd: EXAMPLE_ROOT,
});

const CATALOGS: Record<Locale, CompiledCatalogMessages> = {
  en: enMessages,
  de: deMessages,
  es: esMessages,
  fr: frMessages,
};

export function getLocaleLabel(locale: Locale): string {
  return locales.label(locale);
}

export function loadMessages(locale: Locale): CompiledCatalogMessages {
  return CATALOGS[locale];
}

export const remixI18n = createRemixI18nServer({
  locales,
  strategy: "tld",
  loadMessages,
  catalogAssets: { registry: catalogAssetRegistry },
});

export function resolveLocaleFromRequest(request: Request): ResolvedLocale {
  return remixI18n.resolveLocale(request);
}

export function getTldBanner(request: Request, locale: Locale): string | null {
  const suggestion = locales.suggest({
    acceptLanguageHeader: request.headers.get("accept-language"),
    cookieHeader: request.headers.get("cookie"),
    currentLocale: locale,
    pathname: "/",
    requestHost: request.headers.get("host"),
  });

  return suggestion
    ? `${suggestion.description} Switch to the recommended locale: ${suggestion.recommendedLocale}.`
    : null;
}

export function getTldSwitchLinks(request: Request) {
  const host = request.headers.get("host") ?? "remix.example.com:4063";
  return LOCALES.map((locale) => ({
    href: locales.canonicalUrl({ locale, pathname: "/", requestHost: host }),
    locale,
  }));
}

export function resolveLocaleRedirect(
  request: Request,
  locale: Locale,
  redirect: FormDataEntryValue | null,
  fallback: string,
): string {
  const allowedRedirect = getTldSwitchLinks(request).find((item) => item.locale === locale)?.href;
  return typeof redirect === "string" && redirect === allowedRedirect ? redirect : fallback;
}
import path from "node:path";
