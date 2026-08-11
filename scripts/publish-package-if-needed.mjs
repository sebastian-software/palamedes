import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"

import { isMissingFromRegistry, javascriptWorkspacePackages } from "./release-packages.mjs"

const root = process.cwd()
// On Windows the package manager binaries resolve to `pnpm.cmd`/`npm.cmd`.
// Node refuses to spawn `.cmd`/`.bat` files without a shell (CVE-2024-27980),
// so run through the shell there; POSIX keeps the direct, unquoted spawn.
const useShell = process.platform === "win32"
const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const allJavaScript = args.includes("--all-js")
const packageName = args.find((arg) => !arg.startsWith("--"))
const prereleaseTag = process.env.PALAMEDES_NPM_PRERELEASE_TAG?.trim() || "next"

if (allJavaScript) {
  if (packageName) {
    console.error("Usage: node ./scripts/publish-package-if-needed.mjs --all-js [--dry-run]")
    process.exit(1)
  }
  process.exit(publishAllJavaScriptPackages())
}

if (!packageName) {
  console.error(
    "Usage: node ./scripts/publish-package-if-needed.mjs <package-name> [--dry-run] | --all-js [--dry-run]"
  )
  process.exit(1)
}

const workspacePackage = findWorkspacePackage(packageName)
const packageJson = workspacePackage.packageJson
const packageSpec = `${packageName}@${packageJson.version}`
const publishTagArgs = npmPublishTagArgs(packageJson.version)
const viewResult = spawnSync(command("pnpm"), ["view", packageSpec, "version"], {
  cwd: root,
  encoding: "utf8",
  shell: useShell,
})

if (viewResult.error) {
  console.error(viewResult.error)
  process.exit(1)
}

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
  const tagDescription = publishTagArgs.length > 0 ? ` with npm dist-tag ${publishTagArgs[1]}` : ""
  console.log(`${packageSpec} is not published yet; dry-run would publish${tagDescription}.`)
  process.exit(0)
}

const publishResult = isNativeArtifactPackage(packageJson)
  ? spawnSync(
      command("npm"),
      ["publish", workspacePackage.directory, "--access", "public", ...publishTagArgs],
      {
        cwd: root,
        stdio: "inherit",
        shell: useShell,
      }
    )
  : spawnSync(
      command("pnpm"),
      [
        // Filter by directory, not by name: the private workspace root is also
        // named `palamedes`, so a name filter selects two projects.
        "--filter",
        workspacePackage.filter,
        "publish",
        "--access",
        "public",
        "--no-git-checks",
        ...publishTagArgs,
      ],
      {
        cwd: root,
        stdio: "inherit",
        shell: useShell,
      }
    )

if (publishResult.error) {
  console.error(publishResult.error)
  process.exit(1)
}

process.exit(publishResult.status ?? 1)

function command(name) {
  return process.platform === "win32" ? `${name}.cmd` : name
}

function publishAllJavaScriptPackages() {
  const failures = []
  const script = process.argv[1]
  const childArgs = dryRun ? ["--dry-run"] : []

  for (const packageInfo of javascriptWorkspacePackages(root)) {
    const result = spawnSync(process.execPath, [script, packageInfo.name, ...childArgs], {
      cwd: root,
      stdio: "inherit",
    })
    if (result.error) {
      console.error(result.error)
      failures.push(packageInfo.name)
    } else if (result.status !== 0) {
      failures.push(packageInfo.name)
    }
  }

  if (failures.length === 0) {
    return 0
  }

  console.error(`JavaScript package publishing failed: ${failures.join(", ")}`)
  return 1
}

function npmPublishTagArgs(version) {
  if (!isPrereleaseVersion(version)) {
    return []
  }

  if (prereleaseTag === "latest") {
    console.error("Refusing to publish a prerelease with npm dist-tag latest.")
    process.exit(1)
  }

  return ["--tag", prereleaseTag]
}

function isPrereleaseVersion(version) {
  return /^\d+\.\d+\.\d+-[0-9A-Za-z.-]+$/.test(version)
}

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
        // pnpm filter paths stay POSIX-style on every host.
        filter: `./packages/${directory}`,
        packageJson,
      }
    }
  }

  console.error(`${name} is not a workspace package.`)
  process.exit(1)
}

function isMissingPackageVersion(output) {
  return isMissingFromRegistry(output)
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
