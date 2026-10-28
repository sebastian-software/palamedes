import { createBundledServerI18n } from "@palamedes/runtime/server/bundled";
import { createServerI18nScope } from "@palamedes/runtime/server";
import type { Locale } from "./i18n";

export const serverI18nScope = createServerI18nScope();

export function createServerI18n(locale: Locale) {
  return createBundledServerI18n({ locale, timeZone: "Europe/Berlin" });
}

export async function runServerI18n<Result>(
  locale: Locale,
  work: () => Result | Promise<Result>,
): Promise<Result> {
  const i18n = await createServerI18n(locale);
  return serverI18nScope.run(i18n, work);
}
