import { execFileSync } from "node:child_process"
import path from "node:path"

const packageDir = path.resolve(import.meta.dirname, "..")
const repoRoot = path.resolve(packageDir, "../..")
const platformPackage = resolvePlatformPackage()
const platformPackageDir = path.join(
  repoRoot,
  "packages",
  platformPackage.replace("@palamedes/", "")
)

execFileSync(process.execPath, [path.join(packageDir, "scripts", "build-native.mjs")], {
  cwd: platformPackageDir,
  stdio: "inherit",
})
execFileSync(process.execPath, [path.join(packageDir, "scripts", "build.mjs")], {
  cwd: packageDir,
  stdio: "inherit",
})
execFileSync(process.execPath, [path.join(packageDir, "scripts", "install.mjs")], {
  cwd: packageDir,
  stdio: "inherit",
})

const publicBin = path.join(packageDir, "bin", "pmds")
const command = process.platform === "win32" ? process.execPath : publicBin
const args = process.platform === "win32" ? [publicBin, "version"] : ["version"]
const output = execFileSync(command, args, {
  cwd: packageDir,
  encoding: "utf8",
})

if (!output.includes("pmds (Palamedes)")) {
  throw new Error(`Unexpected pmds version output: ${output}`)
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
  console.warn(`Skipping Palamedes CLI smoke test on ${process.platform}/${process.arch}.`)
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
