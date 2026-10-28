import { createBundledServerI18n } from "@palamedes/runtime/server/bundled";
import { createServerI18nScope } from "@palamedes/runtime/server";
import type { Locale } from "./i18n";

export const serverI18nScope =
  createServerI18nScope<Awaited<ReturnType<typeof createBundledServerI18n>>>();

export function createServerI18n(locale: Locale) {
  return createBundledServerI18n({ locale, timeZone: "Europe/Berlin" });
}
