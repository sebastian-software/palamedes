import { defineLocaleControls } from "@palamedes/core/locale";
import { createServerI18nScope } from "@palamedes/runtime/server";
import { createNodeI18n, defaultLocale, locales } from "./i18n.ts";

export const requestScope = createServerI18nScope();
const controls = defineLocaleControls({ locales, defaultLocale });

export function requestI18n(acceptLanguage: string | undefined) {
  return createNodeI18n(controls.preferredLocale(acceptLanguage));
}
