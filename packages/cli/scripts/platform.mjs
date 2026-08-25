import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

const require = createRequire(import.meta.url)
const SUPPORTED_TARGETS =
  "darwin/arm64, linux/x64 glibc, linux/x64 musl, linux/arm64 glibc, linux/arm64 musl, and win32/x64"

function readPackageVersion(packageName, packageJsonPath, readFile, wrapperVersion) {
  let manifest
  try {
    manifest = JSON.parse(readFile(packageJsonPath, "utf8"))
  } catch (error) {
    if (wrapperVersion) {
      throw new Error(
        `Palamedes CLI native package ${packageName} has invalid package metadata at ${packageJsonPath}. ` +
          `Reinstall ${packageName} or install matching ${packageName}@${wrapperVersion}.`,
        { cause: error }
      )
    }
    throw new Error(
      `Palamedes CLI could not read its own package metadata at ${packageJsonPath}. ` +
        "Reinstall @palamedes/cli.",
      { cause: error }
    )
  }

  if (typeof manifest?.version !== "string" || manifest.version.trim().length === 0) {
    if (wrapperVersion) {
      throw new Error(
        `Palamedes CLI native package ${packageName} has no valid version in ${packageJsonPath}. ` +
          `Reinstall ${packageName} or install matching ${packageName}@${wrapperVersion}.`
      )
    }
    throw new Error(
      `Palamedes CLI could not read its own version from ${packageJsonPath}. Reinstall @palamedes/cli.`
    )
  }

  return manifest.version
}

export function assertNativeExecutableVersion(wrapperVersion, packageName, nativeVersion) {
  if (nativeVersion === wrapperVersion) {
    return
  }

  throw new Error(
    `Palamedes CLI version mismatch: @palamedes/cli@${wrapperVersion} resolved ${packageName}@${nativeVersion}. ` +
      "Reinstall @palamedes/cli so its exact optional platform dependency is refreshed, " +
      `or install matching ${packageName}@${wrapperVersion}.`
  )
}

export function resolveNativeExecutable(options = {}) {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const packageName = resolvePlatformPackage({
    platform,
    arch,
    libc: options.libc,
    report: options.report,
  })
  const resolvePackageJson =
    options.resolvePackageJson ?? ((specifier) => require.resolve(specifier))
  const readFile = options.readFileSync ?? readFileSync
  const wrapperPackageJsonPath =
    options.wrapperPackageJsonPath ?? path.join(import.meta.dirname, "..", "package.json")

  let packageJsonPath
  try {
    packageJsonPath = resolvePackageJson(`${packageName}/package.json`)
  } catch (error) {
    throw new Error(
      `Palamedes CLI native package ${packageName} is not installed for this platform. ` +
        `Install optional dependencies or add ${packageName} explicitly.`,
      { cause: error }
    )
  }

  const wrapperVersion = readPackageVersion("@palamedes/cli", wrapperPackageJsonPath, readFile)
  const nativeVersion = readPackageVersion(packageName, packageJsonPath, readFile, wrapperVersion)
  assertNativeExecutableVersion(wrapperVersion, packageName, nativeVersion)

  const binaryName = platform === "win32" ? "pmds.exe" : "pmds"
  const binaryPath = path.join(path.dirname(packageJsonPath), "bin", binaryName)
  const pathExists = options.existsSync ?? existsSync
  if (!pathExists(binaryPath)) {
    throw new Error(
      `Palamedes CLI native package ${packageName} is installed, but its binary is missing at ${binaryPath}. ` +
        "Reinstall the package or add the platform package explicitly."
    )
  }

  return binaryPath
}

export function resolvePlatformPackage(options = {}) {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const libc = options.libc ?? detectLinuxLibc({ platform, report: options.report })

  if (platform === "darwin" && arch === "arm64") {
    return "@palamedes/cli-darwin-arm64"
  }
  if (platform === "linux" && arch === "x64" && libc === "glibc") {
    return "@palamedes/cli-linux-x64-gnu"
  }
  if (platform === "linux" && arch === "x64" && libc === "musl") {
    return "@palamedes/cli-linux-x64-musl"
  }
  if (platform === "linux" && arch === "arm64" && libc === "glibc") {
    return "@palamedes/cli-linux-arm64-gnu"
  }
  if (platform === "linux" && arch === "arm64" && libc === "musl") {
    return "@palamedes/cli-linux-arm64-musl"
  }
  if (platform === "win32" && arch === "x64") {
    return "@palamedes/cli-win32-x64-msvc"
  }
  if (platform === "linux" && !libc) {
    throw new Error(
      `Palamedes CLI could not determine the Linux C library for ${platform}/${arch}. ` +
        `Supported targets are ${SUPPORTED_TARGETS}.`
    )
  }
  throw new Error(
    `Palamedes CLI does not publish a native binary for ${platform}/${arch}${libc ? ` ${libc}` : ""}. ` +
      `Supported targets are ${SUPPORTED_TARGETS}.`
  )
}

export function detectLinuxLibc(options = {}) {
  const platform = options.platform ?? process.platform
  if (platform !== "linux") {
    return null
  }

  const report = options.report ?? process.report?.getReport?.()
  const glibcVersion = report?.header?.glibcVersionRuntime
  if (typeof glibcVersion === "string" && glibcVersion.length > 0) {
    return "glibc"
  }

  const sharedObjects = Array.isArray(report?.sharedObjects) ? report.sharedObjects : []
  if (sharedObjects.some((sharedObject) => sharedObject.includes("musl"))) {
    return "musl"
  }
  if (
    sharedObjects.some(
      (sharedObject) => sharedObject.includes("libc.so.6") || sharedObject.includes("ld-linux")
    )
  ) {
    return "glibc"
  }

  return null
}
