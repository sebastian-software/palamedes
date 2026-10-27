import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// On Windows the package manager binaries resolve to `npm.cmd`. Node refuses to
// spawn `.cmd`/`.bat` files without a shell (CVE-2024-27980), so run through the
// shell there; POSIX keeps the direct, unquoted spawn.
const useShell = process.platform === "win32";

export function publicWorkspacePackages(root = process.cwd()) {
  return readdirSync(path.join(root, "packages"))
    .map((directory) => {
      const packagePath = path.join("packages", directory);
      const packageJsonPath = path.join(root, packagePath, "package.json");

      if (!existsSync(packageJsonPath)) {
        return null;
      }

      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

      if (packageJson.private) {
        return null;
      }

      return {
        directory: packagePath,
        manifest: packageJson,
        name: packageJson.name,
        nativeArtifact: nativeArtifact(packageJson),
        version: packageJson.version,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function javascriptWorkspacePackages(root = process.cwd()) {
  return dependencyOrderedWorkspacePackages(
    publicWorkspacePackages(root).filter((packageInfo) => !packageInfo.nativeArtifact),
  );
}

// Publish order matters because pnpm turns workspace references into registry
// ranges in the packed manifest. Keep independent packages deterministic while
// ensuring each workspace dependency reaches npm before its dependents.
export function dependencyOrderedWorkspacePackages(packages, { warn = console.warn } = {}) {
  const packagesByName = new Map();

  for (const packageInfo of packages) {
    if (typeof packageInfo.name !== "string" || packageInfo.name.length === 0) {
      throw new Error("Cannot order workspace packages without a package name.");
    }

    if (packagesByName.has(packageInfo.name)) {
      throw new Error(`Cannot order workspace packages with duplicate name ${packageInfo.name}.`);
    }

    packagesByName.set(packageInfo.name, packageInfo);
  }

  const dependenciesByPackage = new Map();
  for (const packageInfo of packagesByName.values()) {
    dependenciesByPackage.set(
      packageInfo.name,
      workspacePublishDependencies(packageInfo.manifest, packagesByName, [
        "dependencies",
        "optionalDependencies",
      ]),
    );
  }

  // Hard workspace dependencies must always form a valid publish order.
  dependencyOrder(packagesByName, dependenciesByPackage);

  const peerEdges = [...packagesByName.values()]
    .flatMap((packageInfo) =>
      [
        ...workspacePublishDependencies(packageInfo.manifest, packagesByName, ["peerDependencies"]),
      ].map((dependencyName) => ({ dependencyName, packageName: packageInfo.name })),
    )
    .sort(
      (left, right) =>
        left.packageName.localeCompare(right.packageName) ||
        left.dependencyName.localeCompare(right.dependencyName),
    );

  for (const { dependencyName, packageName } of peerEdges) {
    const dependencies = dependenciesByPackage.get(packageName);
    if (dependencies.has(dependencyName)) {
      continue;
    }
    if (hasDependencyPath(dependenciesByPackage, dependencyName, packageName)) {
      warn(
        `Ignoring workspace peer dependency publish-order hint ${dependencyName} -> ${packageName} because it would create a cycle.`,
      );
      continue;
    }
    dependencies.add(dependencyName);
  }

  return dependencyOrder(packagesByName, dependenciesByPackage);
}

function dependencyOrder(packagesByName, dependenciesByPackage) {
  const dependents = new Map([...packagesByName.keys()].map((name) => [name, []]));
  const dependencyCounts = new Map();

  for (const [packageName, dependencies] of dependenciesByPackage) {
    dependencyCounts.set(packageName, dependencies.size);
    for (const dependencyName of dependencies) {
      dependents.get(dependencyName).push(packageName);
    }
  }
  for (const names of dependents.values()) {
    names.sort((a, b) => a.localeCompare(b));
  }
  const ready = [...packagesByName.keys()]
    .filter((name) => dependencyCounts.get(name) === 0)
    .sort((a, b) => a.localeCompare(b));
  const ordered = [];

  while (ready.length > 0) {
    const name = ready.shift();
    ordered.push(packagesByName.get(name));

    for (const dependent of dependents.get(name)) {
      const remainingDependencies = dependencyCounts.get(dependent) - 1;
      dependencyCounts.set(dependent, remainingDependencies);

      if (remainingDependencies === 0) {
        ready.push(dependent);
        ready.sort((a, b) => a.localeCompare(b));
      }
    }
  }

  if (ordered.length !== packagesByName.size) {
    const cycle = [...dependencyCounts]
      .filter(([, count]) => count > 0)
      .map(([name]) => name)
      .sort((a, b) => a.localeCompare(b));

    throw new Error(
      `Cannot publish workspace packages in dependency order: dependency cycle detected among ${cycle.join(", ")}.`,
    );
  }

  return ordered;
}

function hasDependencyPath(dependenciesByPackage, start, target) {
  const seen = new Set();
  const pending = [start];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === target) {
      return true;
    }
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    pending.push(...dependenciesByPackage.get(current));
  }
  return false;
}

function workspacePublishDependencies(packageJson, packagesByName, fields) {
  const dependencies = new Set();

  for (const field of fields) {
    const declaredDependencies = packageJson?.[field];
    if (declaredDependencies === null || typeof declaredDependencies !== "object") {
      continue;
    }

    for (const [name, version] of Object.entries(declaredDependencies)) {
      if (
        typeof version === "string" &&
        version.startsWith("workspace:") &&
        packagesByName.has(name)
      ) {
        dependencies.add(name);
      }
    }
  }

  return dependencies;
}

function nativeArtifact(packageJson) {
  const isPlatformPackage =
    typeof packageJson.name === "string" &&
    (packageJson.name.startsWith("@palamedes/core-node-") ||
      packageJson.name.startsWith("@palamedes/cli-")) &&
    Array.isArray(packageJson.os) &&
    Array.isArray(packageJson.cpu);

  if (!isPlatformPackage) {
    return null;
  }

  if (typeof packageJson.bin === "object" && packageJson.bin !== null) {
    const artifact = Object.values(packageJson.bin).find((value) => typeof value === "string");
    return artifact?.replace(/^\.\//, "") ?? null;
  }

  return typeof packageJson.main === "string" ? packageJson.main.replace(/^\.\//, "") : null;
}

// `npm view` exits non-zero both for "this does not exist" and for transport or
// auth failures. Only the former is a fact about the registry, so the callers
// need the distinction rather than a bare exit code.
export function registryLookup(spec, field = "version", root = process.cwd()) {
  const result = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["view", spec, field],
    {
      cwd: root,
      encoding: "utf8",
      shell: useShell,
    },
  );

  if (result.error) {
    return { state: "error", detail: String(result.error) };
  }

  if (result.status === 0) {
    return { state: "found", value: (result.stdout ?? "").trim() };
  }

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

  if (isMissingFromRegistry(output)) {
    return { state: "missing", detail: output.trim() };
  }

  return { state: "error", detail: output.trim() };
}

export function isMissingFromRegistry(output) {
  return (
    output.includes("404 Not Found") ||
    output.includes("npm error code E404") ||
    output.includes("[ERR_PNPM_FETCH_404]") ||
    output.includes("[ERR_PNPM_PACKAGE_NOT_FOUND]") ||
    output.includes("[E404]") ||
    output.includes("No match found for version") ||
    output.includes("No matching version found for") ||
    output.includes("is not in the npm registry")
  );
}

const WORKSPACE_DEPENDENCY_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies"];
const MANIFEST_DEPENDENCY_FIELDS = [...WORKSPACE_DEPENDENCY_FIELDS, "devDependencies"];

// pnpm replaces workspace references when it packs a package. These are the
// ranges consumers receive: `workspace:*` pins the exact coordinated version
// (the native optional dependencies rely on this), `workspace:^` and
// `workspace:~` keep their operator, and an explicit range stays as written.
export function expectedWorkspaceRange(specifier, version) {
  const range = specifier.slice("workspace:".length);
  if (range === "*") return version;
  if (range === "^" || range === "~") return `${range}${version}`;
  return range;
}

// Compares a packed manifest with its source manifest. `workspaceVersions`
// maps every public workspace package name to the version it publishes.
export function packedManifestProblems(sourceManifest, packedManifest, workspaceVersions) {
  const problems = [];
  for (const field of ["name", "version"]) {
    if (packedManifest?.[field] !== sourceManifest[field]) {
      problems.push(
        `packed ${field} is ${String(packedManifest?.[field])}, expected ${sourceManifest[field]}`,
      );
    }
  }

  for (const field of MANIFEST_DEPENDENCY_FIELDS) {
    for (const [name, specifier] of Object.entries(packedManifest?.[field] ?? {})) {
      if (typeof specifier === "string" && /^(?:workspace|catalog):/u.test(specifier)) {
        problems.push(`${field}.${name} still uses ${specifier} after packing`);
      }
    }
  }

  for (const field of WORKSPACE_DEPENDENCY_FIELDS) {
    for (const [name, specifier] of Object.entries(sourceManifest[field] ?? {})) {
      if (typeof specifier !== "string" || !specifier.startsWith("workspace:")) continue;
      const version = workspaceVersions.get(name);
      if (!version) {
        problems.push(`${field}.${name} uses ${specifier}, but ${name} is not a public package`);
        continue;
      }
      const expected = expectedWorkspaceRange(specifier, version);
      const packed = packedManifest?.[field]?.[name];
      if (packed !== expected) {
        problems.push(
          `${field}.${name} packed as ${String(packed)}, expected ${expected} from ${specifier}`,
        );
      }
    }
  }

  return problems;
}
