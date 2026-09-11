import "server-only";

import { createNextServerI18n } from "@palamedes/next-plugin/server";
import { getLocale } from "./lib/i18n.server";

/** Locale policy for every instrumented Server Function. */
export async function initializeServerFunctionI18n(): Promise<void> {
  const { locale } = await getLocale();
  await createNextServerI18n({ locale });
}
