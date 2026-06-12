import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"

const root = process.cwd()
const nativePackagePattern = /^@palamedes\/core-node-.+/

function readJson(file) {
  return JSON.parse(readFileSync(path.join(root, file), "utf8"))
}

function readText(file) {
  return readFileSync(path.join(root, file), "utf8")
}

function fail(message) {
  console.error(message)
  process.exitCode = 1
}

const releaseConfig = readJson(".release-please-config.json")
const releaseManifest = readJson(".release-please-manifest.json")
const publishWorkflow = readText(".github/workflows/publish.yml")
const rootReleasePath = "."
const rootReleaseConfig = releaseConfig.packages?.[rootReleasePath]
const rootReleaseExtraFiles = rootReleaseConfig?.["extra-files"] ?? []
const requiredTomlExtraFiles = [
  {
    type: "toml",
    path: "crates/palamedes/Cargo.toml",
    jsonpath: "$.package.version",
  },
  {
    type: "toml",
    path: "crates/palamedes-node/Cargo.toml",
    jsonpath: "$.package.version",
  },
  {
    type: "toml",
    path: "Cargo.lock",
    jsonpath: '$.package[?(@.name.value=="palamedes")].version',
  },
  {
    type: "toml",
    path: "Cargo.lock",
    jsonpath: '$.package[?(@.name.value=="palamedes-node")].version',
  },
]

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
  rootReleaseExtraFiles
    .filter((file) => file?.type === "json" && file?.jsonpath === "$.version")
    .map((file) => file.path)
)
const workflowFilters = new Set(
  Array.from(publishWorkflow.matchAll(/--filter\s+([^\s]+)/g), (match) =>
    match[1].replaceAll(/^"|"$/g, "")
  )
)
const nativeMatrixPackages = new Set(
  Array.from(publishWorkflow.matchAll(/package_name:\s+"([^"]+)"/g), (match) => match[1])
)
const expectedVersion = publicPackages[0]?.version
const versionFile = rootReleaseConfig?.["version-file"]
const versionFileVersion = versionFile ? readText(versionFile).trim() : undefined

function hasExtraFile(expectedFile) {
  return rootReleaseExtraFiles.some(
    (file) =>
      file?.type === expectedFile.type &&
      file?.path === expectedFile.path &&
      file?.jsonpath === expectedFile.jsonpath
  )
}

function cargoManifestVersion(file) {
  return readText(file).match(/^version = "([^"]+)"/m)?.[1]
}

function cargoLockVersion(packageName) {
  const escapedName = packageName.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return readText("Cargo.lock").match(
    new RegExp(`\\[\\[package\\]\\]\\nname = "${escapedName}"\\nversion = "([^"]+)"`)
  )?.[1]
}

if (!rootReleaseConfig) {
  fail(`${rootReleasePath} is missing from .release-please-config.json`)
} else {
  if (rootReleaseConfig.component !== "palamedes") {
    fail(`root release component is ${rootReleaseConfig.component}, expected palamedes`)
  }

  if (rootReleaseConfig["release-type"] !== "simple") {
    fail(`root release type is ${rootReleaseConfig["release-type"]}, expected simple`)
  }

  if (versionFile !== ".release-please-version") {
    fail(`root release version file is ${versionFile}, expected .release-please-version`)
  }
}

if (versionFileVersion !== expectedVersion) {
  fail(`${versionFile} tracks ${versionFileVersion}, but public packages are at ${expectedVersion}`)
}

if (releaseManifest[rootReleasePath] !== expectedVersion) {
  fail(
    `release manifest tracks ${releaseManifest[rootReleasePath]}, but public packages are at ${expectedVersion}`
  )
}

for (const requiredFile of requiredTomlExtraFiles) {
  if (!hasExtraFile(requiredFile)) {
    fail(`${requiredFile.path} ${requiredFile.jsonpath} is missing from root release extra-files`)
  }
}

for (const [name, version] of [
  ["palamedes", cargoManifestVersion("crates/palamedes/Cargo.toml")],
  ["palamedes-node", cargoManifestVersion("crates/palamedes-node/Cargo.toml")],
  ["Cargo.lock palamedes", cargoLockVersion("palamedes")],
  ["Cargo.lock palamedes-node", cargoLockVersion("palamedes-node")],
]) {
  if (version !== expectedVersion) {
    fail(`${name} has version ${version}, expected ${expectedVersion}`)
  }
}

for (const packageInfo of publicPackages) {
  if (packageInfo.version !== expectedVersion) {
    fail(`${packageInfo.name} has version ${packageInfo.version}, expected ${expectedVersion}`)
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
