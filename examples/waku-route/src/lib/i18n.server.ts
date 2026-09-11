import { createViteServerI18n } from "@palamedes/vite-plugin/server";
import { createServerI18nScope } from "@palamedes/runtime/server";
import type { Locale } from "./i18n";

export const serverI18nScope =
  createServerI18nScope<Awaited<ReturnType<typeof createViteServerI18n>>>();

export function createServerI18n(locale: Locale) {
  return createViteServerI18n({ locale });
}
