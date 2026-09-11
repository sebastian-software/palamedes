const CATALOG_READY_PROMISE = Symbol.for("palamedes.document-catalogs-ready-promise");

/**
 * Boots React Router's standard RSC client entry after the adapter-owned
 * catalog delivery probe has settled. Import this module for the usual
 * side-effect bootstrap in `app/entry.client.tsx`.
 */
export async function bootstrapReactRouterRscClient(): Promise<void> {
  const runtime = globalThis as typeof globalThis & Record<symbol, unknown>;
  const catalogReady = runtime[CATALOG_READY_PROMISE];
  if (catalogReady && typeof (catalogReady as PromiseLike<unknown>).then === "function") {
    await catalogReady;
  }
  await import("@react-router/dev/config/default-rsc-entries/entry.client");
}

await bootstrapReactRouterRscClient();
