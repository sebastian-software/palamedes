export type CatalogCompilationCompletion = { ok: true } | { ok: false };

export type CoreNodeProcessState = {
  version: 1;
  initialCatalogBuilds: Map<string, Promise<CatalogCompilationCompletion>>;
  mutationTails: Map<string, Promise<void>>;
  mutationAdmissionTail: Promise<void>;
};

const PROCESS_STATE_KEY = Symbol.for("palamedes.core-node.process-state.v1");

/**
 * Keep coordination state shared when Node loads both package entry formats.
 * CJS and ESM bundles each contain this module, so module-local state would
 * otherwise be duplicated even though both wrappers use the same addon.
 */
export function getCoreNodeProcessState(): CoreNodeProcessState {
  const globalState = globalThis as typeof globalThis & Record<string | symbol, unknown>;
  const existing = globalState[PROCESS_STATE_KEY] as CoreNodeProcessState | undefined;
  if (
    existing?.version === 1 &&
    existing.initialCatalogBuilds instanceof Map &&
    existing.mutationTails instanceof Map &&
    existing.mutationAdmissionTail instanceof Promise
  ) {
    return existing;
  }

  const created: CoreNodeProcessState = {
    version: 1,
    initialCatalogBuilds: new Map(),
    mutationTails: new Map(),
    mutationAdmissionTail: Promise.resolve(),
  };
  globalState[PROCESS_STATE_KEY] = created;
  return created;
}
