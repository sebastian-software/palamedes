import { copyFileSync, existsSync } from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { buildNativePackage } from "../../../scripts/build-native-lib.mjs"

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
  "@palamedes/core-node-linux-arm64-musl": {
    platform: "linux",
    arch: "arm64",
    libc: "musl",
    rustTarget: "aarch64-unknown-linux-musl",
  },
  "@palamedes/core-node-win32-x64-msvc": {
    platform: "win32",
    arch: "x64",
  },
}

buildNativePackage({
  targets,
  cargoPackage: "palamedes-node",
  unsupportedTargetMessage: (packageName) => `Unsupported native target package: ${packageName}`,
  configureCargo({ cargoEnv, target }) {
    if (target.libc !== "musl") {
      return
    }

    // musl defaults to `+crt-static`, and cargo refuses to produce a `cdylib` for a
    // statically linked target ("does not support these crate types"). Disabling
    // crt-static has to reach cargo's crate-type check in the build *plan*, so it
    // must go through RUSTFLAGS rather than trailing `cargo rustc -- <flags>`, which
    // only reach the final crate too late for that check.
    //
    // The override is scoped to the musl *target* (not the global RUSTFLAGS), so
    // host build scripts and proc-macros stay untouched.
    //
    // IMPORTANT: with crt-static off the cdylib links *dynamically*, so this build
    // must run in a musl-native toolchain (see the "Build musl core-node addon"
    // step in .github/workflows/publish.yml, which runs it inside `rust:alpine`
    // on a runner of the same architecture). Cross-linking the dynamic cdylib
    // from a glibc host makes the linker emit a glibc program interpreter
    // (`ld-linux-*.so`), and the resulting `.node` then fails to load inside a
    // musl runtime with `ERR_DLOPEN_FAILED`. A musl-native `cc` instead resolves
    // the correct `ld-musl-*.so.1` loader, so no external `musl-gcc` linker or
    // `link-self-contained` flag is needed. (The static-musl CLI *binary* keeps
    // `+crt-static` and links fully statically, which is why it builds fine on
    // the glibc host.)
    //
    // `panic=abort` is intentionally not forced here. Every synchronous export in
    // `palamedes-node` opts into napi-rs's `#[napi(catch_unwind)]` guard, so Rust
    // panics become catchable JavaScript errors instead of unwinding across the
    // FFI boundary — matching the gnu, darwin, and win32 addons, which all build
    // with the default unwind strategy.
    //
    // Prepend any inherited target rustflags so an externally provided value
    // (e.g. CI optimisation overrides) is preserved rather than dropped.
    const rustflagsVariable = `CARGO_TARGET_${target.rustTarget.toUpperCase().replaceAll("-", "_")}_RUSTFLAGS`
    cargoEnv[rustflagsVariable] = [
      process.env[rustflagsVariable] ?? "",
      "-C target-feature=-crt-static",
    ]
      .filter(Boolean)
      .join(" ")
  },
  postBuild({ packageDir, profile, repoRoot, target }) {
    const extensionByPlatform = {
      darwin: "dylib",
      linux: "so",
      win32: "dll",
    }
    const extension = extensionByPlatform[process.platform]
    if (!extension) {
      throw new Error(`Unsupported platform for Palamedes native build: ${process.platform}`)
    }

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

    if (process.platform !== "darwin") {
      return
    }

    // The copied N-API module can carry an invalid embedded signature after the
    // cargo build/copy step. Re-sign it ad hoc so Node can dlopen it reliably.
    execFileSync("codesign", ["--force", "--sign", "-", "--timestamp=none", targetPath], {
      cwd: packageDir,
      stdio: "inherit",
    })
  },
})
