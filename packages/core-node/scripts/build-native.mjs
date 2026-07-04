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
const cargoArgs = ["build", "--package", "palamedes-node"]

if (profile === "release") {
  cargoArgs.push("--release")
}

if (target.rustTarget) {
  cargoArgs.push("--target", target.rustTarget)
}

const cargoEnv = { ...process.env }

if (muslNodeAddon) {
  // musl defaults to `+crt-static`, and cargo refuses to produce a `cdylib` for a
  // statically linked target ("does not support these crate types"). Disabling
  // crt-static has to reach cargo's crate-type check in the build *plan*, so it
  // must go through RUSTFLAGS rather than trailing `cargo rustc -- <flags>`, which
  // only reach the final crate too late for that check.
  //
  // The override is scoped to the musl *target* (not the global RUSTFLAGS), so
  // host build scripts and proc-macros stay untouched. `link-self-contained=+unwind`
  // supplies the unwinder in-tree for every cdylib built for this target —
  // including the `oxc_sourcemap` cdylib — so musl-gcc never looks for a shared
  // `libgcc_s` that the Ubuntu musl toolchain does not ship.
  //
  // `panic=abort` is intentionally not forced here. napi-rs (`#[napi]`) wraps
  // every `extern "C"` entry point in a panic guard, so panics are converted to
  // JS errors and never unwind across the FFI boundary. The gnu, darwin, and
  // win32 addons already build with the default unwind strategy for the same
  // reason; scoping abort to musl only would diverge from them and force the
  // whole musl dependency graph off the prebuilt unwind std.
  //
  // Prepend any inherited target rustflags so an externally provided value
  // (e.g. CI optimisation overrides) is preserved rather than dropped.
  cargoEnv.CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_RUSTFLAGS = [
    process.env.CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_RUSTFLAGS ?? "",
    "-C target-feature=-crt-static",
    "-C link-self-contained=+unwind",
  ]
    .filter(Boolean)
    .join(" ")
}

execFileSync("cargo", cargoArgs, {
  cwd: repoRoot,
  env: cargoEnv,
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
