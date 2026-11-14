import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { renderCatalogModule } from "@palamedes/core-node";

import {
  createCatalogCompiler,
  readChunks,
  scanMarkers,
  splitRenderedCatalog,
} from "./client-catalog-chunks";
import { clientCatalogMapName } from "./client-catalog-map";

export type EmitClientCatalogAssetsOptions = {
  distDir: string;
  projectRoot: string;
  configPath?: string;
  failOnMissing: boolean;
  /** The build token withPalamedes() inlined into the server code. */
  buildToken: string;
};

// The rendered module imports defineCompiledCatalog; an asset loaded outside
// the bundler cannot resolve that, so the bootstrap brands it on receive.
function bareMessageAsset(rendered: string): string {
  const { declarations, literal } = splitRenderedCatalog(rendered);
  return `${declarations}export const messages=(${literal});`;
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
 * locale.
 */
export async function emitClientCatalogAssets(
  options: EmitClientCatalogAssetsOptions,
): Promise<Record<string, string>> {
  const staticDir = path.join(options.distDir, "static");
  const { sidecars, chunkKeys } = scanMarkers(await readChunks(path.join(staticDir, "chunks")));
  const importers = new Map<string, number>();
  for (const keys of chunkKeys.values()) {
    for (const key of keys) importers.set(key, (importers.get(key) ?? 0) + 1);
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

  const compiler = await createCatalogCompiler(options, sidecars);
  const outputDir = path.join(staticDir, "palamedes");
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  // Locale to the file name of its map, for the build checks.
  const maps: Record<string, string> = {};
  for (const locale of compiler.locales) {
    const assets: Record<string, string[]> = {};
    const compiled = await compiler.compileLocale(locale);
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
