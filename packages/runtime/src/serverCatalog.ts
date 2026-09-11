import {
  defineCompiledCatalog,
  isCompiledCatalog,
  type CatalogMessage,
  type CompiledCatalogMessages,
} from "@palamedes/core";

export type ServerCatalogLoadContext<TLocale extends string = string> = {
  readonly locale: TLocale;
  /** Monotonically increasing generation for development invalidation. */
  readonly generation: number;
};

/** A loader may return multiple ordered generated sidecars for one locale. */
export type ServerCatalogLoader<TLocale extends string = string> = (
  context: ServerCatalogLoadContext<TLocale>,
) => Promise<readonly CompiledCatalogMessages[]>;

export type ServerCatalogStoreStats = {
  readonly readyLocales: number;
  readonly inFlightLocales: number;
  readonly retainedFragments: number;
  readonly retainedMessages: number;
};

export type ServerCatalogStore<TLocale extends string = string> = {
  load(locale: TLocale): Promise<CompiledCatalogMessages>;
  getReady(locale: TLocale): CompiledCatalogMessages | undefined;
  invalidate(locale?: TLocale): void;
  generation(locale: TLocale): number;
  stats(): ServerCatalogStoreStats;
};

type CatalogEntry = {
  generation: number;
  ready?: CompiledCatalogMessages;
  fragmentCount?: number;
  inFlight?: Promise<CompiledCatalogMessages>;
};

/**
 * Deduplicates complete compiled catalog loads inside one server process.
 *
 * The merged catalog is prepared once per locale generation. Request runtimes
 * can pass the returned immutable generated catalog to their existing load()
 * contract without rebuilding a per-message lookup object. Successful
 * catalogs remain retained until a host invalidates their locale.
 */
export function createServerCatalogStore<TLocale extends string = string>(options: {
  load: ServerCatalogLoader<TLocale>;
}): ServerCatalogStore<TLocale> {
  const entries = new Map<TLocale, CatalogEntry>();

  function entryFor(locale: TLocale): CatalogEntry {
    const existing = entries.get(locale);
    if (existing) return existing;
    const created: CatalogEntry = { generation: 0 };
    entries.set(locale, created);
    return created;
  }

  function load(locale: TLocale): Promise<CompiledCatalogMessages> {
    const entry = entryFor(locale);
    if (entry.ready) return Promise.resolve(entry.ready);
    if (entry.inFlight) return entry.inFlight;

    const generation = entry.generation;
    const attempt: Promise<CompiledCatalogMessages> = Promise.resolve()
      .then(() => options.load({ locale, generation }))
      .then((fragments) => {
        const prepared = prepareCatalog(fragments);
        const current = entries.get(locale);
        if (current?.generation === generation && current.inFlight === attempt) {
          current.ready = prepared.messages;
          current.fragmentCount = prepared.fragmentCount;
          current.inFlight = undefined;
        }
        return prepared.messages;
      })
      .catch((error: unknown) => {
        const current = entries.get(locale);
        if (current?.generation === generation && current.inFlight === attempt) {
          current.inFlight = undefined;
        }
        throw error;
      });
    entry.inFlight = attempt;
    return attempt;
  }

  function invalidate(locale?: TLocale): void {
    if (locale !== undefined) {
      invalidateEntry(entryFor(locale));
      return;
    }
    for (const entry of entries.values()) invalidateEntry(entry);
  }

  return {
    load,
    getReady(locale) {
      return entries.get(locale)?.ready;
    },
    invalidate,
    generation(locale) {
      return entryFor(locale).generation;
    },
    stats() {
      let readyLocales = 0;
      let inFlightLocales = 0;
      let retainedFragments = 0;
      let retainedMessages = 0;
      for (const entry of entries.values()) {
        if (entry.ready) {
          readyLocales += 1;
          retainedFragments += entry.fragmentCount ?? 1;
          retainedMessages += Object.keys(entry.ready).length;
        }
        if (entry.inFlight) inFlightLocales += 1;
      }
      return { readyLocales, inFlightLocales, retainedFragments, retainedMessages };
    },
  };
}

function invalidateEntry(entry: CatalogEntry): void {
  entry.generation += 1;
  entry.ready = undefined;
  entry.fragmentCount = undefined;
  // An old promise may still resolve for an already-running request. Clearing
  // this reference lets a new generation start immediately; its identity check
  // prevents the old promise from changing the current entry.
  entry.inFlight = undefined;
}

function prepareCatalog(fragments: readonly CompiledCatalogMessages[]): {
  messages: CompiledCatalogMessages;
  fragmentCount: number;
} {
  if (fragments.length === 0) {
    return { messages: defineCompiledCatalog({}), fragmentCount: 0 };
  }

  const merged: Record<string, unknown> = Object.create(null);
  for (const fragment of fragments) {
    if (!isCompiledCatalog(fragment)) {
      throw new TypeError("Server catalog loaders must return generated compiled catalogs.");
    }
    for (const [id, message] of Object.entries(fragment)) merged[id] = message;
  }

  return {
    messages: defineCompiledCatalog(merged as Record<string, CatalogMessage>),
    fragmentCount: fragments.length,
  };
}
