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

let manifest: ClientCatalogManifest | undefined;

/*
 * The manifest is written after compilation, so the server reads it from the
 * build output at runtime. `PALAMEDES_NEXT_DIST_DIR` is the dist dir relative
 * to the project, and the working directory is the project directory under
 * `next start`, in the standalone `server.js` (it changes into its own
 * directory), and in hosted functions. withPalamedes() adds the manifest to
 * the server traces, so it travels with every deployment of the build.
 */
function readManifest(distDir: string): ClientCatalogManifest {
  const manifestPath = path.resolve(process.cwd(), distDir, CLIENT_CATALOG_MANIFEST);
  try {
    return JSON.parse(
      readFileSync(/* turbopackIgnore: true */ manifestPath, "utf8"),
    ) as ClientCatalogManifest;
  } catch (error) {
    throw new Error(
      `Palamedes Next client catalogs: cannot read ${manifestPath}. This build delivers client catalogs as assets, so the server needs the manifest from its build output. Start the server in the project directory (next start) or from the standalone output (node server.js), and keep ${distDir}/${CLIENT_CATALOG_MANIFEST} when you copy the build.`,
      { cause: error },
    );
  }
}

/**
 * Reads the client catalog manifest of the running build once per process, or
 * returns `null` when the build delivers client catalogs in its module graph.
 * A failed read throws and is not cached, so a restored file is picked up.
 */
export function readClientCatalogManifest(): ClientCatalogManifest | null {
  const distDir = process.env.PALAMEDES_NEXT_DIST_DIR;
  if (!distDir) return null;
  manifest ??= readManifest(distDir);
  return manifest;
}
