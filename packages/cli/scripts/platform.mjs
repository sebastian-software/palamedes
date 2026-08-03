import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

const require = createRequire(import.meta.url)
const SUPPORTED_TARGETS =
  "darwin/arm64, linux/x64 glibc, linux/x64 musl, linux/arm64 glibc, and win32/x64"

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
