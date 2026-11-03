import { readFileSync } from "node:fs";
import path from "node:path";

/** The server-side manifest the post-compile step writes into the dist dir. */
export const CLIENT_CATALOG_MANIFEST = "palamedes-client-catalogs.json";

/**
 * Locale to the public URL of that locale's catalog map asset. The map asset
 * itself lists every translated module, so the document only carries its URL.
 */
export type ClientCatalogManifest = {
  maps: Record<string, string>;
};

let manifest: ClientCatalogManifest | null | undefined;

/**
 * Reads the client catalog manifest of the running build once per process, or
 * returns `null` when the build delivers client catalogs in its module graph.
 */
export function readClientCatalogManifest(): ClientCatalogManifest | null {
  if (manifest !== undefined) return manifest;
  const distDir = process.env.PALAMEDES_NEXT_DIST_DIR;
  try {
    manifest = distDir
      ? (JSON.parse(
          readFileSync(path.join(process.cwd(), distDir, CLIENT_CATALOG_MANIFEST), "utf8"),
        ) as ClientCatalogManifest)
      : null;
  } catch {
    manifest = null;
  }
  return manifest;
}
