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
  return publicWorkspacePackages(root).filter((packageInfo) => !packageInfo.nativeArtifact)
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
