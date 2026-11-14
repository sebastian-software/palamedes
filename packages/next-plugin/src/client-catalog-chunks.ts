import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { catalogMatchesSource, catalogResourcePath, loadPalamedesConfig } from "@palamedes/config";
import { compileCatalogArtifactSelectedAsync } from "@palamedes/core-node";
import { createMissingErrorMessage } from "@palamedes/transform";

/*
 * Shared by the two out-of-graph delivery modes (ADR-030 assets, ADR-031
 * permutations): both read the catalog markers the transform loader left in
 * the emitted client chunks and compile each catalog once per locale.
 */

/** `"pmds-next:<key>:<payload>"`, with the key and the base64url payload captured. */
export const MARKER_PATTERN = /["'`]pmds-next:([0-9a-f]{12}):([\w-]+)["'`]/gu;

const RENDERED_CATALOG_IMPORT =
  'import{defineCompiledCatalog as __palamedesDefineCompiledCatalog}from"@palamedes/core/compiled";';
const RENDERED_CATALOG_EXPORT = "export const messages=__palamedesDefineCompiledCatalog(";
const RENDERED_CATALOG_SUFFIX = ");export default { messages };";

export type Sidecar = { source: string; ids: string[] };

export type MarkerScan = {
  /** Module key to the source path and message IDs the loader recorded. */
  sidecars: Map<string, Sidecar>;
  /** Absolute chunk path to the sorted module keys it contains. */
  chunkKeys: Map<string, string[]>;
};

export async function listChunks(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
}

/*
 * The chunks are the source of truth, so a cached loader result that never
 * ran in this build is still covered.
 */
export function scanMarkers(chunks: Iterable<[string, string]>): MarkerScan {
  const sidecars = new Map<string, Sidecar>();
  const chunkKeys = new Map<string, string[]>();
  for (const [chunk, source] of chunks) {
    const keys = new Set<string>();
    for (const [, key, payload] of source.matchAll(MARKER_PATTERN)) {
      keys.add(key!);
      if (!sidecars.has(key!)) {
        sidecars.set(key!, JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")));
      }
    }
    if (keys.size > 0) chunkKeys.set(chunk, [...keys].sort());
  }
  return { sidecars, chunkKeys };
}

export async function readChunks(directory: string): Promise<Map<string, string>> {
  const sources = new Map<string, string>();
  for (const chunk of await listChunks(directory)) {
    sources.set(chunk, await readFile(chunk, "utf8"));
  }
  return sources;
}

export type CatalogCompilerOptions = {
  projectRoot: string;
  configPath?: string;
  failOnMissing: boolean;
};

export type CatalogCompiler = {
  locales: string[];
  sourceLocale: string;
  pseudoLocale: string | undefined;
  /** Module key to its selected messages for the locale. */
  compileLocale(locale: string): Promise<Map<string, Record<string, string>>>;
};

/*
 * Each catalog compiles once per locale for the union of the IDs its modules
 * use; parsing the catalog once per module dominated the step.
 */
export async function createCatalogCompiler(
  options: CatalogCompilerOptions,
  sidecars: Map<string, Sidecar>,
): Promise<CatalogCompiler> {
  const cfg = await loadPalamedesConfig({
    projectRoot: options.projectRoot,
    ...(options.configPath ? { configPath: options.configPath } : {}),
  });
  const artifactConfig = {
    rootDir: cfg.rootDir,
    locales: cfg.locales,
    sourceLocale: cfg.sourceLocale,
    fallbackLocales: cfg.fallbackLocales,
    pseudoLocale: cfg.pseudoLocale,
    catalogs: cfg.catalogs,
  };
  const catalogKeys = cfg.catalogs.map((catalog) =>
    [...sidecars.keys()].filter((key) =>
      catalogMatchesSource(cfg, catalog, path.join(cfg.rootDir, sidecars.get(key)!.source)),
    ),
  );

  return {
    locales: [...cfg.locales],
    sourceLocale: cfg.sourceLocale,
    pseudoLocale: cfg.pseudoLocale,
    async compileLocale(locale) {
      const selections = new Map<string, Record<string, string>>(
        [...sidecars.keys()].map((key) => [key, {}]),
      );
      for (const [index, catalog] of cfg.catalogs.entries()) {
        const keys = catalogKeys[index]!;
        if (keys.length === 0) continue;
        const ids = [...new Set(keys.flatMap((key) => sidecars.get(key)!.ids))].sort();
        const artifact = await compileCatalogArtifactSelectedAsync(
          artifactConfig,
          catalogResourcePath(cfg, catalog, locale),
          ids,
        );
        const resolvedLocale = artifact.resolvedLocaleChain?.[0] ?? locale;
        if (artifact.missing.length > 0 && resolvedLocale !== cfg.pseudoLocale) {
          const message = createMissingErrorMessage(resolvedLocale, artifact.missing);
          if (options.failOnMissing) throw new Error(message);
          console.warn(message);
        }
        for (const key of keys) {
          const selected = selections.get(key)!;
          for (const id of sidecars.get(key)!.ids) {
            if (Object.hasOwn(artifact.messages, id)) selected[id] = artifact.messages[id]!;
          }
        }
      }
      return selections;
    },
  };
}

/*
 * The native renderer emits one bundler module per catalog. Both delivery
 * modes need its parts: the declarations of compiled ICU helpers, and the
 * object literal with the messages, without the import and the exports.
 */
export function splitRenderedCatalog(rendered: string): { declarations: string; literal: string } {
  const trimmed = rendered.trimEnd();
  const exportIndex = trimmed.lastIndexOf(RENDERED_CATALOG_EXPORT);
  if (
    !trimmed.startsWith(RENDERED_CATALOG_IMPORT) ||
    !trimmed.endsWith(RENDERED_CATALOG_SUFFIX) ||
    exportIndex === -1
  ) {
    throw new Error(
      "Palamedes Next client catalogs: the native catalog module shape changed; cannot derive a message asset.",
    );
  }
  return {
    declarations: trimmed.slice(RENDERED_CATALOG_IMPORT.length, exportIndex),
    literal: trimmed.slice(
      exportIndex + RENDERED_CATALOG_EXPORT.length,
      trimmed.length - RENDERED_CATALOG_SUFFIX.length,
    ),
  };
}
