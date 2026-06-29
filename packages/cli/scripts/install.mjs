import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

const packageDir = path.resolve(import.meta.dirname, "..")
const binDir = path.join(packageDir, "bin")
const require = createRequire(import.meta.url)
const binaryName = process.platform === "win32" ? "pmds.exe" : "pmds"
const targetPath = path.join(binDir, binaryName)
const packageName = resolvePlatformPackage()

try {
  const nativePackageDir = resolvePackageDir(packageName)
  const sourcePath = path.join(nativePackageDir, "bin", binaryName)
  if (!existsSync(sourcePath)) {
    console.warn(
      `Palamedes CLI optional package ${packageName} is installed but has no binary yet.`
    )
    process.exit(0)
  }
  mkdirSync(binDir, { recursive: true })
  copyFileSync(sourcePath, targetPath)
  if (process.platform !== "win32") {
    chmodSync(targetPath, 0o755)
  }
} catch {
  console.warn(
    `Palamedes CLI binary package ${packageName} is not installed for this platform. ` +
      `Install optional dependencies or add ${packageName} explicitly for native pmds support.`
  )
}

function resolvePackageDir(packageName) {
  try {
    return path.dirname(require.resolve(`${packageName}/package.json`))
  } catch (error) {
    const workspacePackageDir = path.resolve(
      packageDir,
      "..",
      packageName.replace("@palamedes/", "")
    )
    if (existsSync(path.join(workspacePackageDir, "package.json"))) {
      return workspacePackageDir
    }
    throw error
  }
}

function resolvePlatformPackage() {
  const libc = detectLinuxLibc()

  if (process.platform === "darwin" && process.arch === "arm64") {
    return "@palamedes/cli-darwin-arm64"
  }
  if (process.platform === "linux" && process.arch === "x64" && libc === "glibc") {
    return "@palamedes/cli-linux-x64-gnu"
  }
  if (process.platform === "linux" && process.arch === "x64" && libc === "musl") {
    return "@palamedes/cli-linux-x64-musl"
  }
  if (process.platform === "linux" && process.arch === "arm64" && libc === "glibc") {
    return "@palamedes/cli-linux-arm64-gnu"
  }
  if (process.platform === "win32" && process.arch === "x64") {
    return "@palamedes/cli-win32-x64-msvc"
  }
  console.warn(
    `Palamedes CLI does not publish a native binary for ${process.platform}/${process.arch}. ` +
      "Supported targets are darwin/arm64, linux/x64 glibc, linux/x64 musl, linux/arm64 glibc, and win32/x64."
  )
  process.exit(0)
}

function detectLinuxLibc() {
  if (process.platform !== "linux") {
    return null
  }

  const report = process.report?.getReport?.()
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
