import { cp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Copy the application and its production dependency closure out of the
 * frozen workspace install. Unlike `pnpm deploy --legacy`, this never
 * re-resolves registry metadata, so it works offline on a clean CI cache.
 */
export async function createProductionDeployment(applicationRoot, target) {
  const placed = new Map();
  const edges = [];
  const application = await readManifest(applicationRoot);
  await copyPackage(applicationRoot, application, target);

  // Breadth-first placement lets a parent claim its own versions before its
  // descendants hoist theirs, which keeps nested conflicts resolvable.
  const queue = [{ source: applicationRoot, manifest: application, location: target }];
  while (queue.length > 0) {
    const parent = queue.shift();
    for (const { name, optional } of runtimeDependencies(parent.manifest)) {
      const source = await findInstalled(parent.source, name);
      if (!source) {
        if (optional) continue;
        throw new Error(`${parent.manifest.name} depends on ${name}, which is not installed.`);
      }
      edges.push({ from: parent.location, name, source });
      const existing = lookup(placed, target, parent.location, name);
      if (existing && placed.get(existing) === source) continue;
      const location = existing
        ? path.join(parent.location, "node_modules", name)
        : path.join(target, "node_modules", name);
      const manifest = await readManifest(source);
      placed.set(location, source);
      await copyPackage(source, manifest, location);
      queue.push({ source, manifest, location });
    }
  }

  for (const edge of edges) {
    if (placed.get(lookup(placed, target, edge.from, edge.name)) !== edge.source) {
      throw new Error(`${edge.name} does not resolve to its installed version from ${edge.from}.`);
    }
  }
}

function runtimeDependencies(manifest) {
  const optionalPeers = manifest.peerDependenciesMeta ?? {};
  return [
    ...Object.keys(manifest.dependencies ?? {}).map((name) => ({ name, optional: false })),
    ...Object.keys(manifest.optionalDependencies ?? {}).map((name) => ({ name, optional: true })),
    ...Object.keys(manifest.peerDependencies ?? {})
      .filter((name) => !optionalPeers[name]?.optional)
      .map((name) => ({ name, optional: true })),
  ];
}

/** Follow Node's lookup from `location` up to the deployment root. */
function lookup(placed, target, location, name) {
  for (let directory = location; ; directory = path.dirname(directory)) {
    if (path.basename(directory) !== "node_modules") {
      const candidate = path.join(directory, "node_modules", name);
      if (placed.has(candidate)) return candidate;
    }
    if (directory === target) return;
  }
}

async function findInstalled(from, name) {
  for (let directory = from; ; directory = path.dirname(directory)) {
    if (path.basename(directory) !== "node_modules") {
      try {
        return await realpath(path.join(directory, "node_modules", name));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    if (path.dirname(directory) === directory) return;
  }
}

async function copyPackage(source, manifest, location) {
  await mkdir(location, { recursive: true });
  if (source.split(path.sep).includes("node_modules")) {
    // Registry packages are already their published contents.
    await cp(source, location, {
      recursive: true,
      dereference: true,
      filter: (file) => !path.relative(source, file).split(path.sep).includes("node_modules"),
    });
    return;
  }
  // Workspace packages ship their `files` and a manifest without dev tooling.
  const published = { ...manifest };
  delete published.devDependencies;
  await writeFile(path.join(location, "package.json"), JSON.stringify(published, null, 2));
  for (const entry of manifest.files ?? []) {
    try {
      await cp(path.join(source, entry), path.join(location, entry), {
        recursive: true,
        dereference: true,
      });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

async function readManifest(directory) {
  return JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
}
