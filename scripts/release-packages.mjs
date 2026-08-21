import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"

// On Windows the package manager binaries resolve to `npm.cmd`. Node refuses to
// spawn `.cmd`/`.bat` files without a shell (CVE-2024-27980), so run through the
// shell there; POSIX keeps the direct, unquoted spawn.
const useShell = process.platform === "win32"

export function publicWorkspacePackages(root = process.cwd()) {
  return readdirSync(path.join(root, "packages"))
    .map((directory) => {
      const packagePath = path.join("packages", directory)
      const packageJsonPath = path.join(root, packagePath, "package.json")

      if (!existsSync(packageJsonPath)) {
        return null
      }

      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"))

      if (packageJson.private) {
        return null
      }

      return {
        directory: packagePath,
        manifest: packageJson,
        name: packageJson.name,
        nativeArtifact: nativeArtifact(packageJson),
        version: packageJson.version,
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function javascriptWorkspacePackages(root = process.cwd()) {
  return dependencyOrderedWorkspacePackages(
    publicWorkspacePackages(root).filter((packageInfo) => !packageInfo.nativeArtifact)
  )
}

// Publish order matters because pnpm turns workspace references into registry
// ranges in the packed manifest. Keep independent packages deterministic while
// ensuring each workspace dependency reaches npm before its dependents.
export function dependencyOrderedWorkspacePackages(packages) {
  const packagesByName = new Map()

  for (const packageInfo of packages) {
    if (typeof packageInfo.name !== "string" || packageInfo.name.length === 0) {
      throw new Error("Cannot order workspace packages without a package name.")
    }

    if (packagesByName.has(packageInfo.name)) {
      throw new Error(`Cannot order workspace packages with duplicate name ${packageInfo.name}.`)
    }

    packagesByName.set(packageInfo.name, packageInfo)
  }

  const dependents = new Map([...packagesByName.keys()].map((name) => [name, []]))
  const dependencyCounts = new Map([...packagesByName.keys()].map((name) => [name, 0]))

  for (const packageInfo of packagesByName.values()) {
    for (const dependencyName of workspacePublishDependencies(
      packageInfo.manifest,
      packagesByName
    )) {
      dependents.get(dependencyName).push(packageInfo.name)
      dependencyCounts.set(packageInfo.name, dependencyCounts.get(packageInfo.name) + 1)
    }
  }

  for (const names of dependents.values()) {
    names.sort((a, b) => a.localeCompare(b))
  }

  const ready = [...packagesByName.keys()]
    .filter((name) => dependencyCounts.get(name) === 0)
    .sort((a, b) => a.localeCompare(b))
  const ordered = []

  while (ready.length > 0) {
    const name = ready.shift()
    ordered.push(packagesByName.get(name))

    for (const dependent of dependents.get(name)) {
      const remainingDependencies = dependencyCounts.get(dependent) - 1
      dependencyCounts.set(dependent, remainingDependencies)

      if (remainingDependencies === 0) {
        ready.push(dependent)
        ready.sort((a, b) => a.localeCompare(b))
      }
    }
  }

  if (ordered.length !== packagesByName.size) {
    const cycle = [...dependencyCounts]
      .filter(([, count]) => count > 0)
      .map(([name]) => name)
      .sort((a, b) => a.localeCompare(b))

    throw new Error(
      `Cannot publish workspace packages in dependency order: dependency cycle detected among ${cycle.join(", ")}.`
    )
  }

  return ordered
}

function workspacePublishDependencies(packageJson, packagesByName) {
  const dependencies = new Set()

  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    const declaredDependencies = packageJson?.[field]
    if (declaredDependencies === null || typeof declaredDependencies !== "object") {
      continue
    }

    for (const [name, version] of Object.entries(declaredDependencies)) {
      if (
        typeof version === "string" &&
        version.startsWith("workspace:") &&
        packagesByName.has(name)
      ) {
        dependencies.add(name)
      }
    }
  }

  return dependencies
}

function nativeArtifact(packageJson) {
  const isPlatformPackage =
    typeof packageJson.name === "string" &&
    (packageJson.name.startsWith("@palamedes/core-node-") ||
      packageJson.name.startsWith("@palamedes/cli-")) &&
    Array.isArray(packageJson.os) &&
    Array.isArray(packageJson.cpu)

  if (!isPlatformPackage) {
    return null
  }

  if (typeof packageJson.bin === "object" && packageJson.bin !== null) {
    const artifact = Object.values(packageJson.bin).find((value) => typeof value === "string")
    return artifact?.replace(/^\.\//, "") ?? null
  }

  return typeof packageJson.main === "string" ? packageJson.main.replace(/^\.\//, "") : null
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
    }
  )

  if (result.error) {
    return { state: "error", detail: String(result.error) }
  }

  if (result.status === 0) {
    return { state: "found", value: (result.stdout ?? "").trim() }
  }

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`

  if (isMissingFromRegistry(output)) {
    return { state: "missing", detail: output.trim() }
  }

  return { state: "error", detail: output.trim() }
}

export function isMissingFromRegistry(output) {
  return (
    output.includes("404 Not Found") ||
    output.includes("[ERR_PNPM_FETCH_404]") ||
    output.includes("[ERR_PNPM_PACKAGE_NOT_FOUND]") ||
    output.includes("[E404]") ||
    output.includes("No matching version found for") ||
    output.includes("is not in the npm registry")
  )
}
