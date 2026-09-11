import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/** Pack the complete local dependency graph, so unreleased fixtures never mix registry versions. */
export function packWorkspaceDependencies(packageDir, archiveDir) {
  const packagesRoot = path.resolve(packageDir, "..");
  const packages = new Map(
    readdirSync(packagesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const directory = path.join(packagesRoot, entry.name);
        const manifest = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
        return [manifest.name, { directory, manifest }];
      }),
  );
  const overrides = {};
  const pack = (directory) => {
    const manifest = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
    if (Object.hasOwn(overrides, manifest.name)) return;
    const before = new Set(readdirSync(archiveDir));
    execFileSync(
      process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      ["pack", "--pack-destination", archiveDir],
      {
        cwd: directory,
        stdio: "pipe",
        shell: process.platform === "win32",
      },
    );
    const archives = readdirSync(archiveDir).filter(
      (name) => name.endsWith(".tgz") && !before.has(name),
    );
    assert.equal(archives.length, 1, `Expected one archive for ${manifest.name}`);
    overrides[manifest.name] = `file:${path.join(archiveDir, archives[0])}`;
    for (const [name, range] of Object.entries({
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
    })) {
      if (range.startsWith("workspace:")) {
        const dependency = packages.get(name);
        assert.ok(dependency, `Missing local dependency ${name}`);
        pack(dependency.directory);
      }
    }
  };
  pack(packageDir);
  return overrides;
}
