import { createNodeI18n, defaultLocale, locales } from "#palamedes/node";
import { defineLocaleControls } from "@palamedes/core/locale";
import { createServerI18nScope } from "@palamedes/runtime/server";

export const requestScope = createServerI18nScope();
const controls = defineLocaleControls({ locales, defaultLocale });

export function requestI18n(acceptLanguage: string | undefined) {
  return createNodeI18n({ locale: controls.preferredLocale(acceptLanguage), timeZone: "UTC" });
}
