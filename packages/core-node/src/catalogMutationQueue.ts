import { realpath } from "node:fs/promises";
import path from "node:path";

import type { TranslationPatchRequest } from "./generated/palamedes-node-types";
import { getCoreNodeProcessState } from "./processGlobalState";

function isValidLocaleForQueue(locale: string): boolean {
  if (locale.length === 0 || locale.includes("..")) {
    return false;
  }
  const first = locale.charCodeAt(0);
  const last = locale.charCodeAt(locale.length - 1);
  if (!isAsciiAlnum(first) || !isAsciiAlnum(last)) {
    return false;
  }
  for (let i = 0; i < locale.length; i += 1) {
    const code = locale.charCodeAt(i);
    if (!isAsciiAlnum(code) && code !== 45 && code !== 95 && code !== 46) {
      return false;
    }
  }
  return true;
}

function isAsciiAlnum(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isSafeRelativeCatalogPath(value: string): boolean {
  if (
    value.length === 0 ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    value.endsWith("/") ||
    value.endsWith("\\")
  ) {
    return false;
  }
  if (/^[A-Za-z]:/.test(value)) {
    return false;
  }
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return false;
    }
  }
  const segments = value.split(/[\\/]/);
  let lastNonEmpty = "";
  let hasNormal = false;
  for (const segment of segments) {
    if (segment === "") {
      continue;
    }
    lastNonEmpty = segment;
    if (segment === "..") {
      return false;
    }
    if (segment !== ".") {
      hasNormal = true;
    }
  }
  return hasNormal && lastNonEmpty !== ".";
}

export function translationPatchTargetPaths(request: TranslationPatchRequest): string[] {
  const resolvedRoot = path.resolve(request.config.rootDir);
  return request.patches.flatMap((patch) => {
    const catalog = request.config.catalogs.find(
      (candidate) => candidate.path === patch.id.catalog,
    );
    if (!catalog) {
      return [];
    }
    if (!isValidLocaleForQueue(patch.id.locale) || !isSafeRelativeCatalogPath(catalog.path)) {
      return [];
    }

    const extension = catalog.format === "Fcl" ? "fcl" : "po";
    const portableCatalogPath = catalog.path.replaceAll("\\", "/");
    const expanded = portableCatalogPath.replaceAll("{locale}", patch.id.locale);
    if (!isSafeRelativeCatalogPath(expanded)) {
      return [];
    }
    const configuredExtension = path.posix.extname(portableCatalogPath);
    const configuredPath = path.resolve(resolvedRoot, expanded);
    const relativeToRoot = path.relative(resolvedRoot, configuredPath);
    if (
      relativeToRoot === "" ||
      relativeToRoot === ".." ||
      relativeToRoot.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeToRoot)
    ) {
      return [];
    }
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

  const state = getCoreNodeProcessState();
  const { mutationTails, mutationAdmissionTail: currentAdmissionTail } = state;

  // Reserve keys in call order even though realpath resolution is async.
  // Independent mutations only wait for this reservation, not for the work.
  const admission = currentAdmissionTail.then(async () => {
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
  const nextAdmissionTail = admission.then(
    () => {},
    () => {},
  );
  state.mutationAdmissionTail = nextAdmissionTail;

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
