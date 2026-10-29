import "server-only";

import { createActiveServerI18n } from "./lib/i18n.server";

/** Locale policy for every instrumented Server Function. */
export async function initializeServerFunctionI18n(): Promise<void> {
  await createActiveServerI18n();
}
