import "server-only"

import { createExampleI18n } from "./lib/i18n"
import { getLocale, serverI18nScope } from "./lib/i18n.server"

/** Initialize request-local i18n for every instrumented Server Function. */
export async function initializeServerFunctionI18n(): Promise<void> {
  const { locale } = await getLocale()
  const i18n = createExampleI18n()
  i18n.activate(locale)
  serverI18nScope.activate(i18n)
}
