import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

const packageDir = path.resolve(import.meta.dirname, "..")
const binDir = path.join(packageDir, "bin")
const require = createRequire(import.meta.url)
const packageName = resolvePlatformPackage()
const binaryName = process.platform === "win32" ? "pmds.exe" : "pmds"
const targetPath = path.join(binDir, binaryName)

try {
  const packageJson = require.resolve(`${packageName}/package.json`)
  const sourcePath = path.join(path.dirname(packageJson), "bin", binaryName)
  if (!existsSync(sourcePath)) {
    console.warn(
      `Palamedes CLI optional package ${packageName} is installed but has no binary yet.`
    )
    process.exit(0)
  }
  mkdirSync(binDir, { recursive: true })
  copyFileSync(sourcePath, targetPath)
} catch {
  console.warn(`Palamedes CLI binary package ${packageName} is not installed for this platform.`)
}

function resolvePlatformPackage() {
  if (process.platform === "darwin" && process.arch === "x64") {
    return "@palamedes/cli-darwin-x64"
  }
  if (process.platform === "darwin" && process.arch === "arm64") {
    return "@palamedes/cli-darwin-arm64"
  }
  if (process.platform === "linux" && process.arch === "x64") {
    return "@palamedes/cli-linux-x64-gnu"
  }
  if (process.platform === "linux" && process.arch === "arm64") {
    return "@palamedes/cli-linux-arm64-gnu"
  }
  if (process.platform === "win32" && process.arch === "x64") {
    return "@palamedes/cli-win32-x64-msvc"
  }
  throw new Error(`Unsupported platform for Palamedes CLI: ${process.platform}/${process.arch}`)
}
