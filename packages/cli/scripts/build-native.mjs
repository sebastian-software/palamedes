import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"

const packageDir = process.cwd()
const repoRoot = path.resolve(import.meta.dirname, "../../..")
const packageJson = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8"))
const targets = {
  "@palamedes/cli-darwin-arm64": {
    platform: "darwin",
    arch: "arm64",
  },
  "@palamedes/cli-linux-x64-gnu": {
    platform: "linux",
    arch: "x64",
    libc: "glibc",
  },
  "@palamedes/cli-linux-x64-musl": {
    platform: "linux",
    arch: "x64",
    libc: "musl",
    rustTarget: "x86_64-unknown-linux-musl",
  },
  "@palamedes/cli-linux-arm64-gnu": {
    platform: "linux",
    arch: "arm64",
    libc: "glibc",
  },
  "@palamedes/cli-win32-x64-msvc": {
    platform: "win32",
    arch: "x64",
  },
}
const target = targets[packageJson.name]

if (!target) {
  throw new Error(`Unsupported native CLI target package: ${packageJson.name}`)
}

if (process.platform !== target.platform || process.arch !== target.arch) {
  console.log(
    `Skipping native CLI build for ${packageJson.name} on ${process.platform}/${process.arch}`
  )
  process.exit(0)
}

if (
  target.platform === "linux" &&
  target.libc &&
  detectLinuxLibc() !== target.libc &&
  (!target.rustTarget || process.env.PALAMEDES_ALLOW_CROSS_NATIVE !== "1")
) {
  console.log(`Skipping native CLI build for ${packageJson.name} due to libc mismatch`)
  process.exit(0)
}

function detectLinuxLibc() {
  const report = process.report?.getReport?.()
  const glibcVersion = report?.header?.glibcVersionRuntime

  if (typeof glibcVersion === "string" && glibcVersion.length > 0) {
    return "glibc"
  }

  return "musl"
}

const profile = process.env.PALAMEDES_RUST_PROFILE === "release" ? "release" : "debug"
const binaryName = process.platform === "win32" ? "pmds.exe" : "pmds"
const cargoArgs = ["build", "--package", "palamedes-cli"]

if (profile === "release") {
  cargoArgs.push("--release")
}

if (target.rustTarget) {
  cargoArgs.push("--target", target.rustTarget)
}

execFileSync("cargo", cargoArgs, {
  cwd: repoRoot,
  stdio: "inherit",
})

const sourcePath = target.rustTarget
  ? path.join(repoRoot, "target", target.rustTarget, profile, binaryName)
  : path.join(repoRoot, "target", profile, binaryName)
const binDir = path.join(packageDir, "bin")
const targetPath = path.join(binDir, binaryName)

if (!existsSync(sourcePath)) {
  throw new Error(`Expected pmds binary at ${sourcePath}`)
}

mkdirSync(binDir, { recursive: true })
copyFileSync(sourcePath, targetPath)
if (process.platform !== "win32") {
  chmodSync(targetPath, 0o755)
}
