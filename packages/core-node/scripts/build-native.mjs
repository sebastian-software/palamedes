import { copyFileSync, existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

const scriptDir = import.meta.dirname
const packageDir = process.cwd()
const repoRoot = path.resolve(scriptDir, "../../..")

const packageJson = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8"))

const targets = {
  "@palamedes/core-node-darwin-arm64": {
    platform: "darwin",
    arch: "arm64",
  },
  "@palamedes/core-node-linux-x64-gnu": {
    platform: "linux",
    arch: "x64",
    libc: "glibc",
  },
  "@palamedes/core-node-linux-x64-musl": {
    platform: "linux",
    arch: "x64",
    libc: "musl",
    rustTarget: "x86_64-unknown-linux-musl",
  },
  "@palamedes/core-node-linux-arm64-gnu": {
    platform: "linux",
    arch: "arm64",
    libc: "glibc",
  },
  "@palamedes/core-node-win32-x64-msvc": {
    platform: "win32",
    arch: "x64",
  },
}

function detectLinuxLibc() {
  const report = process.report?.getReport?.()
  const glibcVersion = report?.header?.glibcVersionRuntime

  if (typeof glibcVersion === "string" && glibcVersion.length > 0) {
    return "glibc"
  }

  return "musl"
}

const target = targets[packageJson.name]

if (!target) {
  throw new Error(`Unsupported native target package: ${packageJson.name}`)
}

if (process.platform !== target.platform || process.arch !== target.arch) {
  console.log(
    `Skipping native build for ${packageJson.name} on ${process.platform}/${process.arch}`
  )
  process.exit(0)
}

if (
  target.platform === "linux" &&
  target.libc &&
  detectLinuxLibc() !== target.libc &&
  (!target.rustTarget || process.env.PALAMEDES_ALLOW_CROSS_NATIVE !== "1")
) {
  console.log(`Skipping native build for ${packageJson.name} due to libc mismatch`)
  process.exit(0)
}

const profile = process.env.PALAMEDES_RUST_PROFILE === "release" ? "release" : "debug"
const extensionByPlatform = {
  darwin: "dylib",
  linux: "so",
  win32: "dll",
}

const extension = extensionByPlatform[process.platform]

if (!extension) {
  throw new Error(`Unsupported platform for Palamedes native build: ${process.platform}`)
}

const muslNodeAddon = packageJson.name === "@palamedes/core-node-linux-x64-musl"
const cargoArgs = [muslNodeAddon ? "rustc" : "build", "--package", "palamedes-node"]

if (profile === "release") {
  cargoArgs.push("--release")
}

if (target.rustTarget) {
  cargoArgs.push("--target", target.rustTarget)
}

if (muslNodeAddon) {
  // Keep the crt-static override scoped to the final N-API cdylib. Applying it
  // through RUSTFLAGS also changes dependency cdylib builds such as
  // oxc_sourcemap, which makes musl-gcc look for a shared libgcc_s that the
  // Ubuntu musl toolchain does not provide.
  cargoArgs.push(
    "--lib",
    "--",
    "-C",
    "target-feature=-crt-static",
    "-C",
    "panic=abort",
    "-C",
    "link-self-contained=+unwind"
  )
}

execFileSync("cargo", cargoArgs, {
  cwd: repoRoot,
  stdio: "inherit",
})

const binaryName =
  process.platform === "win32" ? "palamedes_node.dll" : `libpalamedes_node.${extension}`
const sourcePath = target.rustTarget
  ? path.join(repoRoot, "target", target.rustTarget, profile, binaryName)
  : path.join(repoRoot, "target", profile, binaryName)
const targetPath = path.join(packageDir, "palamedes-node.node")

if (!existsSync(sourcePath)) {
  throw new Error(`Expected native binary at ${sourcePath}`)
}

copyFileSync(sourcePath, targetPath)

if (process.platform === "darwin") {
  // The copied N-API module can carry an invalid embedded signature after the
  // cargo build/copy step. Re-sign it ad hoc so Node can dlopen it reliably.
  execFileSync("codesign", ["--force", "--sign", "-", "--timestamp=none", targetPath], {
    cwd: packageDir,
    stdio: "inherit",
  })
}
