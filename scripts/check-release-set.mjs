import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"

const root = process.cwd()
const nativePackagePattern = /^@palamedes\/core-node-.+/

function readJson(file) {
  return JSON.parse(readFileSync(path.join(root, file), "utf8"))
}

function fail(message) {
  console.error(message)
  process.exitCode = 1
}

const releaseConfig = readJson(".release-please-config.json")
const releaseManifest = readJson(".release-please-manifest.json")
const publishWorkflow = readFileSync(path.join(root, ".github/workflows/publish.yml"), "utf8")
const rootReleasePath = "."
const rootReleaseConfig = releaseConfig.packages?.[rootReleasePath]

const publicPackages = readdirSync(path.join(root, "packages"))
  .map((directory) => {
    const packagePath = path.join("packages", directory)
    const packageJsonPath = path.join(packagePath, "package.json")

    if (!existsSync(path.join(root, packageJsonPath))) {
      return null
    }

    const packageJson = readJson(packageJsonPath)

    if (packageJson.private) {
      return null
    }

    return {
      isNative: nativePackagePattern.test(packageJson.name),
      name: packageJson.name,
      path: packagePath,
      version: packageJson.version,
    }
  })
  .filter(Boolean)
  .sort((a, b) => a.name.localeCompare(b.name))

const extraVersionFiles = new Set(
  (rootReleaseConfig?.["extra-files"] ?? [])
    .filter((file) => file?.type === "json" && file?.jsonpath === "$.version")
    .map((file) => file.path)
)
const workflowFilters = new Set(
  Array.from(publishWorkflow.matchAll(/--filter\s+([^\s]+)/g), (match) =>
    match[1].replace(/^"|"$/g, "")
  )
)
const nativeMatrixPackages = new Set(
  Array.from(publishWorkflow.matchAll(/package_name:\s+"([^"]+)"/g), (match) => match[1])
)
const expectedVersion = publicPackages[0]?.version

if (!rootReleaseConfig) {
  fail(`${rootReleasePath} is missing from .release-please-config.json`)
} else {
  if (rootReleaseConfig.component !== "palamedes") {
    fail(`root release component is ${rootReleaseConfig.component}, expected palamedes`)
  }

  if (rootReleaseConfig["release-type"] !== "rust") {
    fail(`root release type is ${rootReleaseConfig["release-type"]}, expected rust`)
  }
}

if (releaseManifest[rootReleasePath] !== expectedVersion) {
  fail(
    `release manifest tracks ${releaseManifest[rootReleasePath]}, but public packages are at ${expectedVersion}`
  )
}

for (const packageInfo of publicPackages) {
  if (packageInfo.version !== expectedVersion) {
    fail(
      `${packageInfo.name} has version ${packageInfo.version}, expected ${expectedVersion}`
    )
  }

  if (!extraVersionFiles.has(path.join(packageInfo.path, "package.json"))) {
    fail(`${packageInfo.name} is missing from the root release extra-files list`)
  }

  if (packageInfo.isNative) {
    if (!nativeMatrixPackages.has(packageInfo.name)) {
      fail(`${packageInfo.name} is missing from the native publish matrix`)
    }
  } else if (!workflowFilters.has(packageInfo.name)) {
    fail(`${packageInfo.name} is missing from the JavaScript publish filters`)
  }
}

if (process.exitCode) {
  process.exit(process.exitCode)
}

console.log(
  `Release set is consistent for ${publicPackages.length} public packages at ${expectedVersion}.`
)
