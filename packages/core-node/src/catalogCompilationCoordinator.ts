import path from "node:path"

type CatalogCompilationCompletion =
  | { ok: true }
  | {
      ok: false
      error: unknown
    }

const initialCatalogBuilds = new Map<string, Promise<CatalogCompilationCompletion>>()

/**
 * Keep same-key cache misses out of the native worker pool until the first
 * build has completed. A successful leader warms the native cache before its
 * followers are submitted; a failed leader's error is shared by every
 * follower that arrived while it was running.
 */
export async function coordinateInitialCatalogBuild<T>(
  key: string,
  operation: () => Promise<T>
): Promise<T> {
  const current = initialCatalogBuilds.get(key)
  if (current) {
    const currentCompletion = await current
    if (!currentCompletion.ok) {
      throw currentCompletion.error
    }
    return operation()
  }

  const result = Promise.resolve().then(operation)
  const completion: Promise<CatalogCompilationCompletion> = result.then(
    (): CatalogCompilationCompletion => ({ ok: true }),
    (error: unknown): CatalogCompilationCompletion => ({ ok: false, error })
  )
  initialCatalogBuilds.set(key, completion)

  try {
    return await result
  } finally {
    if (initialCatalogBuilds.get(key) === completion) {
      initialCatalogBuilds.delete(key)
    }
  }
}

export function selectedCatalogBuildKey(
  config: {
    rootDir: string
    locales: string[]
    sourceLocale: string
    fallbackLocales?: string[] | Record<string, string[]>
    pseudoLocale?: string
    catalogs: Array<{
      path: string
      format?: string
      include?: string[]
      exclude?: string[]
    }>
  },
  resourcePath: string
): string {
  return JSON.stringify({
    rootDir: path.resolve(config.rootDir),
    resourcePath: path.resolve(resourcePath),
    locales: config.locales,
    sourceLocale: config.sourceLocale,
    fallbackLocales: config.fallbackLocales,
    pseudoLocale: config.pseudoLocale,
    catalogs: config.catalogs,
  })
}
