import { realpath } from "node:fs/promises";
import path from "node:path";

import type { TranslationPatchRequest } from "./generated/palamedes-node-types";

const mutationTails = new Map<string, Promise<void>>();
let mutationAdmissionTail = Promise.resolve();

export function translationPatchTargetPaths(request: TranslationPatchRequest): string[] {
  return request.patches.flatMap((patch) => {
    const catalog = request.config.catalogs.find(
      (candidate) => candidate.path === patch.id.catalog,
    );
    if (!catalog) {
      return [];
    }

    const extension = catalog.format === "Fcl" ? "fcl" : "po";
    const configuredExtension = path.extname(catalog.path);
    const configuredPath = path.resolve(
      request.config.rootDir,
      catalog.path.replaceAll("{locale}", patch.id.locale),
    );
    if (configuredExtension === `.${extension}`) {
      return [configuredPath];
    }
    if (configuredExtension === "." || configuredExtension.toLowerCase() === `.${extension}`) {
      return [`${configuredPath.slice(0, -configuredExtension.length)}.${extension}`];
    }
    return [`${configuredPath}.${extension}`];
  });
}

async function canonicalMutationPath(targetPath: string): Promise<string> {
  const resolvedPath = path.resolve(targetPath);
  let existingPath = resolvedPath;
  const missingSegments: string[] = [];

  for (;;) {
    try {
      return path.join(await realpath(existingPath), ...missingSegments);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        (error.code !== "ENOENT" && error.code !== "ENOTDIR")
      ) {
        throw error;
      }
    }

    const parentPath = path.dirname(existingPath);
    if (parentPath === existingPath) {
      return resolvedPath;
    }
    missingSegments.unshift(path.basename(existingPath));
    existingPath = parentPath;
  }
}

/** Serialize mutations sharing any target path while preserving cross-file concurrency. */
export async function serializeCatalogMutation<TResult>(
  targetPaths: Iterable<string>,
  operation: () => Promise<TResult>,
): Promise<TResult> {
  const requestedPaths = [...targetPaths];
  if (requestedPaths.length === 0) {
    return operation();
  }

  // Reserve keys in call order even though realpath resolution is async.
  // Independent mutations only wait for this reservation, not for the work.
  const admission = mutationAdmissionTail.then(async () => {
    const reservedKeys = [
      ...new Set(await Promise.all(requestedPaths.map(canonicalMutationPath))),
    ].sort();
    const pending = reservedKeys
      .map((key) => mutationTails.get(key))
      .filter((pendingTail): pendingTail is Promise<void> => pendingTail !== undefined);
    const reservedResult = Promise.all(pending).then(operation);
    const reservedTail = reservedResult.then(
      () => {},
      () => {},
    );

    for (const key of reservedKeys) {
      mutationTails.set(key, reservedTail);
    }

    return { keys: reservedKeys, result: reservedResult, tail: reservedTail };
  });
  mutationAdmissionTail = admission.then(
    () => {},
    () => {},
  );

  const { keys, result, tail } = await admission;

  try {
    return await result;
  } finally {
    for (const key of keys) {
      if (mutationTails.get(key) === tail) {
        mutationTails.delete(key);
      }
    }
  }
}
