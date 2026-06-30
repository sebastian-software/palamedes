import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"

const root = process.cwd()
const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const packageName = args.find((arg) => !arg.startsWith("--"))

if (!packageName) {
  console.error("Usage: node ./scripts/publish-package-if-needed.mjs <package-name> [--dry-run]")
  process.exit(1)
}

const workspacePackage = findWorkspacePackage(packageName)
const packageJson = workspacePackage.packageJson
const packageSpec = `${packageName}@${packageJson.version}`
const viewResult = spawnSync("pnpm", ["view", packageSpec, "version"], {
  cwd: root,
  encoding: "utf8",
})

if (viewResult.status === 0) {
  console.log(`${packageSpec} is already published; skipping.`)
  process.exit(0)
}

const viewOutput = `${viewResult.stdout ?? ""}\n${viewResult.stderr ?? ""}`
if (!isMissingPackageVersion(viewOutput)) {
  process.stdout.write(viewResult.stdout ?? "")
  process.stderr.write(viewResult.stderr ?? "")
  process.exit(viewResult.status ?? 1)
}

if (dryRun) {
  console.log(`${packageSpec} is not published yet; dry-run stops before publishing.`)
  process.exit(0)
}

const publishResult = isNativeArtifactPackage(packageJson)
  ? spawnSync("npm", ["publish", workspacePackage.directory, "--access", "public"], {
      cwd: root,
      stdio: "inherit",
    })
  : spawnSync(
      "pnpm",
      ["--filter", packageName, "publish", "--access", "public", "--no-git-checks"],
      {
        cwd: root,
        stdio: "inherit",
      }
    )
process.exit(publishResult.status ?? 1)

function findWorkspacePackage(name) {
  for (const directory of readdirSync(path.join(root, "packages"))) {
    const packageJsonPath = path.join(root, "packages", directory, "package.json")
    if (!existsSync(packageJsonPath)) {
      continue
    }

    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"))
    if (packageJson.name === name) {
      return {
        directory: path.join(root, "packages", directory),
        packageJson,
      }
    }
  }

  console.error(`${name} is not a workspace package.`)
  process.exit(1)
}

function isMissingPackageVersion(output) {
  return (
    output.includes("404 Not Found") ||
    output.includes("[ERR_PNPM_FETCH_404]") ||
    output.includes("[ERR_PNPM_PACKAGE_NOT_FOUND]") ||
    output.includes("[E404]") ||
    output.includes("No matching version found for") ||
    output.includes("is not in the npm registry")
  )
}

function isNativeArtifactPackage(packageJson) {
  return (
    typeof packageJson.name === "string" &&
    (packageJson.name.startsWith("@palamedes/core-node-") ||
      packageJson.name.startsWith("@palamedes/cli-")) &&
    Array.isArray(packageJson.os) &&
    Array.isArray(packageJson.cpu)
  )
}
