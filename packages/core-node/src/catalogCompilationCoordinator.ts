import path from "node:path";

import { getCoreNodeProcessState, type CatalogCompilationCompletion } from "./processGlobalState";

/**
 * Keep same-key cache misses out of the native worker pool until the first
 * build has completed. A successful leader warms the native cache before its
 * followers are submitted. After a leader failure, followers retry one at a
 * time because cancellation and selected-ID compilation failures are specific
 * to the leader even though the cache key is shared.
 */
export async function coordinateInitialCatalogBuild<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const { initialCatalogBuilds } = getCoreNodeProcessState();
  const current = initialCatalogBuilds.get(key);
  if (current) {
    const currentCompletion = await current;
    if (!currentCompletion.ok) {
      if (initialCatalogBuilds.get(key) === current) {
        initialCatalogBuilds.delete(key);
      }
      return coordinateInitialCatalogBuild(key, operation);
    }
    return operation();
  }

  const result = Promise.resolve().then(operation);
  const completion: Promise<CatalogCompilationCompletion> = result.then(
    (): CatalogCompilationCompletion => ({ ok: true }),
    (): CatalogCompilationCompletion => ({ ok: false }),
  );
  initialCatalogBuilds.set(key, completion);

  try {
    return await result;
  } finally {
    if (initialCatalogBuilds.get(key) === completion) {
      initialCatalogBuilds.delete(key);
    }
  }
}

export function selectedCatalogBuildKey(
  config: {
    rootDir: string;
    locales: string[];
    sourceLocale: string;
    fallbackLocales?: string[] | Record<string, string[]>;
    pseudoLocale?: string;
    catalogs: Array<{
      path: string;
      format?: string;
      include?: string[];
      exclude?: string[];
    }>;
  },
  resourcePath: string,
): string {
  return JSON.stringify({
    rootDir: path.resolve(config.rootDir),
    resourcePath: path.resolve(resourcePath),
    locales: config.locales,
    sourceLocale: config.sourceLocale,
    fallbackLocales: config.fallbackLocales,
    pseudoLocale: config.pseudoLocale,
    catalogs: config.catalogs,
  });
}
