import path from "node:path"
import { execFileSync } from "node:child_process"

const packageDir = path.resolve(import.meta.dirname, "..")
const repoRoot = path.resolve(packageDir, "../..")
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

const binaryPath = path.join(repoRoot, "target", profile, binaryName)
const output = execFileSync(binaryPath, ["version"], {
  cwd: packageDir,
  encoding: "utf8",
})

if (!output.includes("pmds (Palamedes)")) {
  throw new Error(`Unexpected pmds version output: ${output}`)
}
