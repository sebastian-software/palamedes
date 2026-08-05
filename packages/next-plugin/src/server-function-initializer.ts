import { initializeServerFunctionI18n as initializeApplicationServerFunctionI18n } from "@palamedes/next-plugin/server-function-entry"
import { getI18n, loadRegisteredMessages } from "@palamedes/runtime"

/**
 * Generated Server Function imports target this adapter entry.
 * @internal
 */
export async function initializeServerFunctionI18n(): Promise<void> {
  await initializeApplicationServerFunctionI18n()
  const i18n = getI18n()
  await loadRegisteredMessages(i18n, i18n.locale)
}
