import { copyFileSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.resolve(scriptDir, "..")
const repoRoot = path.resolve(packageDir, "../..")

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

const cargoArgs = ["build", "--package", "palamedes-node"]

if (profile === "release") {
  cargoArgs.push("--release")
}

execFileSync("cargo", cargoArgs, {
  cwd: repoRoot,
  stdio: "inherit",
})

const binaryName =
  process.platform === "win32" ? "palamedes_node.dll" : `libpalamedes_node.${extension}`
const sourcePath = path.join(repoRoot, "target", profile, binaryName)
const targetPath = path.join(packageDir, "palamedes-node.node")

if (!existsSync(sourcePath)) {
  throw new Error(`Expected native binary at ${sourcePath}`)
}

copyFileSync(sourcePath, targetPath)
