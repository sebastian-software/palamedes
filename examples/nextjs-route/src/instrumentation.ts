/*
 * With experimentalClientCatalogPermutations, every server process has to
 * bind the locale resolver before its first render. The call is a no-op for
 * builds without the option, including development.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bindClientCatalogPermutations } = await import("@palamedes/next-plugin/server");
    bindClientCatalogPermutations();
  }
}
