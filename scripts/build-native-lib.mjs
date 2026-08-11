import { execFileSync } from "node:child_process"
import { copyFileSync, readFileSync } from "node:fs"
import path from "node:path"

/**
 * Detects the C library of a Linux Node host from Node's process report.
 *
 * Build scripts must not guess musl when no report is available: a false musl
 * result can silently skip a native gnu package in a workspace-wide build.
 */
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

/**
 * Builds one native package after validating its target package against the
 * current host. Package scripts provide target metadata and their artifact
 * copy/sign hook; this module owns the shared release-lane policy.
 */
export function buildNativePackage({
  targets,
  cargoPackage,
  unsupportedTargetMessage,
  configureCargo,
  postBuild,
}) {
  const packageDir = process.cwd()
  const repoRoot = path.resolve(import.meta.dirname, "..")
  const packageJson = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8"))
  const target = targets[packageJson.name]
  const skipIncompatibleTarget = process.argv.includes("--if-compatible")

  if (!target) {
    throw new Error(unsupportedTargetMessage(packageJson.name))
  }

  if (process.platform !== target.platform || process.arch !== target.arch) {
    incompatibleTarget({
      packageJson,
      requirement: `requires ${target.platform}/${target.arch}`,
      skipIncompatibleTarget,
    })
    return
  }

  if (
    target.platform === "linux" &&
    target.libc &&
    detectLinuxLibc() !== target.libc &&
    (!target.rustTarget || process.env.PALAMEDES_ALLOW_CROSS_NATIVE !== "1")
  ) {
    incompatibleTarget({
      packageJson,
      requirement: `requires ${target.libc} libc`,
      skipIncompatibleTarget,
    })
    return
  }

  // Native packages ship via `npm publish`, which — unlike `pnpm publish` —
  // does not embed the workspace-root LICENSE. Keep the declared MIT license
  // accompanied by its text in every platform package.
  copyFileSync(path.join(repoRoot, "LICENSE"), path.join(packageDir, "LICENSE"))

  const profile = process.env.PALAMEDES_RUST_PROFILE === "release" ? "release" : "debug"
  const cargoArgs = ["build", "--package", cargoPackage]
  if (profile === "release") {
    cargoArgs.push("--release")
  }
  if (target.rustTarget) {
    cargoArgs.push("--target", target.rustTarget)
  }

  const cargoEnv = { ...process.env }
  configureCargo?.({ cargoEnv, target })
  execFileSync("cargo", cargoArgs, {
    cwd: repoRoot,
    env: cargoEnv,
    stdio: "inherit",
  })

  postBuild({ packageDir, profile, repoRoot, target })
}

function incompatibleTarget({ packageJson, requirement, skipIncompatibleTarget }) {
  const message = `Cannot build ${packageJson.name} on ${process.platform}/${process.arch}: ${requirement}.`

  if (skipIncompatibleTarget) {
    console.log(`${message} Skipping because --if-compatible was requested.`)
    return
  }

  throw new Error(
    `${message} Re-run on its target host, or use --if-compatible for a workspace-wide build.`
  )
}
