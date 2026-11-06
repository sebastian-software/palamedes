import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { catalogMatchesSource, catalogResourcePath, loadPalamedesConfig } from "@palamedes/config";
import { compileCatalogArtifactSelectedAsync, renderCatalogModule } from "@palamedes/core-node";
import { createMissingErrorMessage } from "@palamedes/transform";

import { clientCatalogMapName } from "./client-catalog-map";

const MARKER_PATTERN = /["'`]pmds-next:([0-9a-f]{12}):([\w-]+)["'`]/gu;
const RENDERED_CATALOG_IMPORT =
  'import{defineCompiledCatalog as __palamedesDefineCompiledCatalog}from"@palamedes/core/compiled";';
const RENDERED_CATALOG_DEFAULT_EXPORT = "export default { messages };";

type Sidecar = { source: string; ids: string[] };

export type EmitClientCatalogAssetsOptions = {
  distDir: string;
  projectRoot: string;
  configPath?: string;
  failOnMissing: boolean;
  /** The build token withPalamedes() inlined into the server code. */
  buildToken: string;
};

async function listChunks(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
}

// The rendered module imports defineCompiledCatalog; an asset loaded outside
// the bundler cannot resolve that, so the bootstrap brands it on receive.
function bareMessageAsset(rendered: string): string {
  if (
    !rendered.startsWith(RENDERED_CATALOG_IMPORT) ||
    !rendered.trimEnd().endsWith(RENDERED_CATALOG_DEFAULT_EXPORT)
  ) {
    throw new Error(
      "Palamedes Next client catalogs: the native catalog module shape changed; cannot derive a message asset.",
    );
  }
  const body = rendered
    .slice(RENDERED_CATALOG_IMPORT.length)
    .replace("__palamedesDefineCompiledCatalog(", "(");
  return body.slice(0, body.lastIndexOf(RENDERED_CATALOG_DEFAULT_EXPORT));
}

function mergeSelections(selections: Record<string, string>[]): Record<string, string> | null {
  const union: Record<string, string> = {};
  for (const selected of selections) {
    for (const [id, message] of Object.entries(selected)) {
      if (Object.hasOwn(union, id) && union[id] !== message) return null;
      union[id] = message;
    }
  }
  return union;
}

/*
 * One map per locale lists every translated module, so a soft navigation to
 * any route finds its asset without another lookup. It is a static module
 * named by the build token: the document carries only its URL, and the
 * browser caches it across pages. Module keys have a fixed length, so each
 * asset lists its modules as one concatenated string, and asset names are
 * relative to the map.
 */
function renderCatalogMap(locale: string, assets: Record<string, string[]>): string {
  const entries = Object.entries(assets)
    .map(([fileName, keys]) => [fileName, [...keys].sort().join("")] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `export default ${JSON.stringify({ locale, assets: Object.fromEntries(entries) })};\n`;
}

function groupName(keys: string[]): string {
  if (keys.length === 1) return keys[0]!;
  return createHash("sha256").update(keys.join("\n")).digest("hex").slice(0, 12);
}

/*
 * Reads the client chunks Next just emitted, finds the catalog markers the
 * transform loader left in them, and writes one message asset per chunk and
 * locale. The chunks are the source of truth, so a cached loader result that
 * never ran in this build is still covered.
 */
export async function emitClientCatalogAssets(
  options: EmitClientCatalogAssetsOptions,
): Promise<Record<string, string>> {
  const staticDir = path.join(options.distDir, "static");
  const sidecars = new Map<string, Sidecar>();
  const chunkKeys = new Map<string, string[]>();
  const importers = new Map<string, number>();

  for (const chunk of await listChunks(path.join(staticDir, "chunks"))) {
    const source = await readFile(chunk, "utf8");
    const keys = new Set<string>();
    for (const [, key, payload] of source.matchAll(MARKER_PATTERN)) {
      keys.add(key!);
      if (!sidecars.has(key!)) {
        sidecars.set(key!, JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")));
      }
    }
    if (keys.size === 0) continue;
    const sorted = [...keys].sort();
    chunkKeys.set(chunk, sorted);
    for (const key of sorted) importers.set(key, (importers.get(key) ?? 0) + 1);
  }

  // A module that Turbopack duplicated into several chunks keeps its own
  // asset, so no chunk downloads another chunk's messages.
  const groups: string[][] = [];
  const grouped = new Set<string>();
  for (const keys of chunkKeys.values()) {
    const owned = keys.filter((key) => importers.get(key) === 1);
    if (owned.length === 0) continue;
    groups.push(owned);
    owned.forEach((key) => grouped.add(key));
  }
  for (const key of [...sidecars.keys()].sort()) {
    if (!grouped.has(key)) groups.push([key]);
  }

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

  // Each catalog compiles once per locale for the union of the IDs its
  // modules use; parsing the catalog once per module dominated the step.
  const catalogKeys = cfg.catalogs.map((catalog) =>
    [...sidecars.keys()].filter((key) =>
      catalogMatchesSource(cfg, catalog, path.join(cfg.rootDir, sidecars.get(key)!.source)),
    ),
  );

  async function compileLocale(locale: string): Promise<Map<string, Record<string, string>>> {
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
  }

  const outputDir = path.join(staticDir, "palamedes");
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  // Locale to the file name of its map, for the build checks.
  const maps: Record<string, string> = {};
  for (const locale of cfg.locales) {
    const assets: Record<string, string[]> = {};
    const compiled = await compileLocale(locale);
    for (const keys of groups) {
      const selections = keys.map((key) => compiled.get(key)!);
      const union = mergeSelections(selections);
      const outputs: [string, Record<string, string>, string[]][] = union
        ? [[groupName(keys), union, keys]]
        : keys.map((key, index) => [key, selections[index]!, [key]]);
      for (const [name, messages, members] of outputs) {
        const asset = bareMessageAsset(renderCatalogModule(messages));
        const hash = createHash("sha256").update(asset).digest("hex").slice(0, 8);
        const fileName = `${name}.${locale}-${hash}.js`;
        await writeFile(path.join(outputDir, fileName), asset);
        assets[fileName] = members;
      }
    }
    const mapName = clientCatalogMapName(locale, options.buildToken);
    if (!mapName) {
      throw new Error(
        `Palamedes Next client catalogs: locale "${locale}" cannot name a catalog map. Use letters, digits, "_" and "-" in locale codes.`,
      );
    }
    await writeFile(path.join(outputDir, mapName), renderCatalogMap(locale, assets));
    maps[locale] = mapName;
  }
  return maps;
}
