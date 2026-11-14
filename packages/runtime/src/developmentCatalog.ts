import type { CompiledCatalogMessages } from "@palamedes/core/compiled";

type DevelopmentCatalogSnapshot = {
  generation: number;
  messages: CompiledCatalogMessages;
};

/** Generated-code plumbing for atomic, document-locale development updates. */
export function createDevelopmentCatalogUpdater(
  load: (generation: number) => Promise<DevelopmentCatalogSnapshot>,
  apply: (messages: CompiledCatalogMessages) => void,
): (generation: number) => Promise<void> {
  let requested = -1;
  let committed = -1;
  const pending = new Map<number, Promise<DevelopmentCatalogSnapshot>>();

  return async (generation) => {
    requested = Math.max(requested, generation);
    while (committed < requested) {
      const wanted = requested;
      let resource = pending.get(wanted);
      if (!resource) {
        resource = load(wanted);
        pending.set(wanted, resource);
      }
      let snapshot: DevelopmentCatalogSnapshot;
      try {
        snapshot = await resource;
      } catch (error) {
        if (wanted < requested) continue;
        throw error;
      } finally {
        if (pending.get(wanted) === resource) pending.delete(wanted);
      }
      if (snapshot.generation < wanted) {
        throw new Error("The development server returned an older catalog generation.");
      }
      // A newer eager/lazy consumer may have committed while this import was
      // pending. Its snapshot wins even when the old network response is last.
      if (snapshot.generation < requested) continue;
      if (snapshot.generation > committed) {
        apply(snapshot.messages);
        committed = snapshot.generation;
      }
    }
  };
}
