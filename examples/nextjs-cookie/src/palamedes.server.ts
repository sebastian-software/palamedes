import "server-only"

import { createActiveServerI18n } from "./lib/i18n.server"

/** Initialize request-local i18n for every instrumented Server Function. */
export async function initializeServerFunctionI18n(): Promise<void> {
  await createActiveServerI18n()
}
