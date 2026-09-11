import path from "node:path";

import { defineLocaleControls, type LocaleSource } from "@palamedes/core/locale";
import { createPalamedesRemixCatalogAssetRegistry } from "@palamedes/remix";
import { createRemixI18nServer } from "@palamedes/remix/server";
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
  cookies: { choice: LOCALE_COOKIE },
  hosts: { locales: { en: "en.lvh.me", de: "de.lvh.me", es: "es.lvh.me" } },
});

export const LOCALE_LABELS = locales.labels;
export const normalizeLocale = locales.normalizeLocale;

const EXAMPLE_ROOT = path.resolve(import.meta.dirname, "..");
export const catalogAssetRegistry = createPalamedesRemixCatalogAssetRegistry({
  cwd: EXAMPLE_ROOT,
});

export function getLocaleLabel(locale: Locale): string {
  return locales.label(locale);
}

export const remixI18n = createRemixI18nServer({
  locales,
  strategy: "route",
  catalogAssets: { registry: catalogAssetRegistry },
  routeParam: "locale",
});

export function resolveLocaleFromRequest(request: Request): ResolvedLocale {
  return remixI18n.resolveLocale(request);
}

export function getRootRedirectLocale(request: Request): Locale {
  return locales.preferredLocale(request.headers.get("accept-language"));
}

export function getRouteBanner(request: Request, locale: Locale): string | null {
  const suggestion = locales.suggest({
    acceptLanguageHeader: request.headers.get("accept-language"),
    cookieHeader: request.headers.get("cookie"),
    currentLocale: locale,
    pathname: `/${locale}`,
    requestHost: request.headers.get("host"),
  });

  return suggestion
    ? `${suggestion.description} Switch to the recommended locale: ${suggestion.recommendedLocale}.`
    : null;
}

export function getRouteSwitchLinks(request: Request) {
  const host = request.headers.get("host") ?? "en.lvh.me:4061";
  return LOCALES.map((locale) => ({
    href: locales.canonicalUrl({ locale, pathname: `/${locale}`, requestHost: host }),
    locale,
  }));
}

export function resolveLocaleRedirect(
  request: Request,
  locale: Locale,
  redirect: FormDataEntryValue | null,
  fallback: string,
): string {
  const allowedRedirect = getRouteSwitchLinks(request).find((item) => item.locale === locale)?.href;
  return typeof redirect === "string" && redirect === allowedRedirect ? redirect : fallback;
}
