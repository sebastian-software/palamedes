import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

type NftTrace = { files: string[]; fileHashes?: string[] };

async function listServerTraces(serverDir: string): Promise<string[]> {
  const traces: string[] = [];
  for (const router of ["app", "pages"]) {
    let entries;
    try {
      entries = await readdir(path.join(serverDir, router), {
        withFileTypes: true,
        recursive: true,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".nft.json")) {
        traces.push(path.join(entry.parentPath, entry.name));
      }
    }
  }
  return traces.sort();
}

/*
 * The manifest only exists after compilation, but Turbopack resolves
 * `outputFileTracingIncludes` while it compiles, so the include would never
 * match. Instead the manifest is appended to each server route's trace, which
 * is what Next itself does for webpack includes. The standalone output and
 * deployment adapters copy a route's traced files from these `.nft.json`
 * files after the build. A Turbopack trace carries a parallel `fileHashes`
 * array; the entry gets a content hash in the format Next's adapter output
 * uses for files it adds itself.
 */
export async function traceClientCatalogManifest(options: {
  distDir: string;
  manifestPath: string;
  hashSalt: string;
}): Promise<number> {
  const manifest = await readFile(options.manifestPath);
  const hash = createHash("sha256")
    .update(options.hashSalt)
    .update("file:")
    .update(manifest)
    .digest("hex");

  let traced = 0;
  for (const tracePath of await listServerTraces(path.join(options.distDir, "server"))) {
    const trace = JSON.parse(await readFile(tracePath, "utf8")) as NftTrace;
    if (!Array.isArray(trace.files)) continue;
    const file = path
      .relative(path.dirname(tracePath), options.manifestPath)
      .split(path.sep)
      .join("/");
    const parallelHashes = trace.fileHashes?.length === trace.files.length;
    const index = trace.files.indexOf(file);
    if (index === -1) {
      trace.files.push(file);
      if (parallelHashes) trace.fileHashes!.push(hash);
    } else if (parallelHashes) {
      trace.fileHashes![index] = hash;
    }
    await writeFile(tracePath, JSON.stringify(trace));
    traced += 1;
  }
  return traced;
}
