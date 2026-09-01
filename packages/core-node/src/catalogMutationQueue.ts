import path from "node:path"

import type { TranslationPatchRequest } from "./generated/palamedes-node-types"

const mutationTails = new Map<string, Promise<void>>()

export function translationPatchTargetPaths(request: TranslationPatchRequest): string[] {
  return request.patches.flatMap((patch) => {
    const catalog = request.config.catalogs.find((candidate) => candidate.path === patch.id.catalog)
    if (!catalog) {
      return []
    }

    const extension = catalog.format === "Fcl" ? "fcl" : "po"
    const configuredPath = path.resolve(
      request.config.rootDir,
      catalog.path.replaceAll("{locale}", patch.id.locale)
    )
    return [
      path.extname(catalog.path) === `.${extension}`
        ? configuredPath
        : `${configuredPath}.${extension}`,
    ]
  })
}

/** Serialize mutations sharing any target path while preserving cross-file concurrency. */
export async function serializeCatalogMutation<TResult>(
  targetPaths: Iterable<string>,
  operation: () => Promise<TResult>
): Promise<TResult> {
  const keys = [...new Set([...targetPaths].map((targetPath) => path.resolve(targetPath)))].sort()
  if (keys.length === 0) {
    return operation()
  }

  const pending = keys
    .map((key) => mutationTails.get(key))
    .filter((pendingTail): pendingTail is Promise<void> => pendingTail !== undefined)
  const result = Promise.all(pending).then(operation)
  const tail = result.then(
    () => {},
    () => {}
  )

  for (const key of keys) {
    mutationTails.set(key, tail)
  }

  try {
    return await result
  } finally {
    for (const key of keys) {
      if (mutationTails.get(key) === tail) {
        mutationTails.delete(key)
      }
    }
  }
}
