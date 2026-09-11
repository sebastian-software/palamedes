import { initializeServerFunctionI18n as initializeApplicationServerFunctionI18n } from "@palamedes/next-plugin/server-function-entry";
import { getI18n } from "@palamedes/runtime";

/**
 * Generated Server Function imports target this adapter entry.
 * @internal
 */
export async function initializeServerFunctionI18n(): Promise<void> {
  await initializeApplicationServerFunctionI18n();
  // Fail before the action body if the application did not activate its request.
  getI18n();
}
