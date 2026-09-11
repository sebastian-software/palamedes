import { createViteServerI18n } from "@palamedes/vite-plugin/server";
import { createServerI18nScope } from "@palamedes/runtime/server";
import type { Locale } from "./i18n";

export const serverI18nScope = createServerI18nScope();

export function createServerI18n(locale: Locale) {
  return createViteServerI18n({ locale });
}

export async function runServerI18n<Result>(
  locale: Locale,
  work: () => Result | Promise<Result>,
): Promise<Result> {
  const i18n = await createServerI18n(locale);
  return serverI18nScope.run(i18n, work);
}
