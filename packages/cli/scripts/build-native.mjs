import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
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
  },
  "@palamedes/cli-linux-arm64-gnu": {
    platform: "linux",
    arch: "arm64",
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

const profile = process.env.PALAMEDES_RUST_PROFILE === "release" ? "release" : "debug"
const binaryName = process.platform === "win32" ? "pmds.exe" : "pmds"
const cargoArgs = ["build", "--package", "palamedes-cli"]

if (profile === "release") {
  cargoArgs.push("--release")
}

execFileSync("cargo", cargoArgs, {
  cwd: repoRoot,
  stdio: "inherit",
})

const sourcePath = path.join(repoRoot, "target", profile, binaryName)
const binDir = path.join(packageDir, "bin")
const targetPath = path.join(binDir, binaryName)

if (!existsSync(sourcePath)) {
  throw new Error(`Expected pmds binary at ${sourcePath}`)
}

mkdirSync(binDir, { recursive: true })
copyFileSync(sourcePath, targetPath)
