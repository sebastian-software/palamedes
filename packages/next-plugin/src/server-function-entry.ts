/**
 * Replaced with the application's palamedes.server module.
 * @internal
 */
export async function initializeServerFunctionI18n(): Promise<never> {
  throw new Error(
    "Palamedes could not resolve the application Server Function initializer. Enable serverFunctions in withPalamedes() and provide one palamedes.server module."
  )
}
