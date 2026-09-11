import { createI18n } from "@palamedes/core/compiled";
import { setClientI18n } from "@palamedes/runtime";
import { defineLocaleControls } from "@palamedes/core/locale";

export const LOCALES = ["en", "de", "es"] as const;
export const DEFAULT_LOCALE = "en";
export const LOCALE_COOKIE = "locale";
export type Locale = (typeof LOCALES)[number];

/** Headless locale controls for this demo (cookie strategy). */
export const locales = defineLocaleControls<Locale>({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  cookies: { locale: LOCALE_COOKIE },
});

export const LOCALE_LABELS = locales.labels;

export function getLocaleLabel(locale: Locale) {
  return locales.label(locale);
}

export function resolveCookieLocale(headers: Record<string, string | undefined>) {
  return locales.resolve({
    strategy: "cookie",
    acceptLanguageHeader: headers["accept-language"],
    cookieHeader: headers.cookie,
  });
}

const clientI18n = createI18n();

export function initializeClientI18n(locale: Locale) {
  clientI18n.activate(locale);

  if (typeof window !== "undefined") {
    document.documentElement.lang = locale;
    setClientI18n(clientI18n);
  }
}

if (typeof window !== "undefined") {
  const locale = document.documentElement.lang;
  if (!locales.isLocale(locale)) {
    throw new Error(
      `Expected a supported server locale in document.lang, received ${JSON.stringify(locale)}`,
    );
  }

  initializeClientI18n(locale);
}
