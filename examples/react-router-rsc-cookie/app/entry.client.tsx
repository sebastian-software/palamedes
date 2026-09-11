// Use React Router's standard RSC client bootstrap. The adapter owns catalog
// delivery in the server response, so this entry contains no app import map.
const runtime = globalThis as typeof globalThis & Record<symbol, unknown>;
const catalogReady = runtime[Symbol.for("palamedes.document-catalogs-ready-promise")];
if (catalogReady && typeof (catalogReady as PromiseLike<unknown>).then === "function") {
  await catalogReady;
}
await import("@react-router/dev/config/default-rsc-entries/entry.client");

export {};
