import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { buildNativePackage, rustArtifactFileName } from "../../../scripts/build-native-lib.mjs";

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
  "@palamedes/cli-linux-arm64-musl": {
    platform: "linux",
    arch: "arm64",
    libc: "musl",
    rustTarget: "aarch64-unknown-linux-musl",
  },
  "@palamedes/cli-win32-x64-msvc": {
    platform: "win32",
    arch: "x64",
  },
};
buildNativePackage({
  targets,
  cargoPackage: "palamedes-cli",
  unsupportedTargetMessage: (packageName) =>
    `Unsupported native CLI target package: ${packageName}`,
  postBuild({ packageDir, profile, repoRoot, target }) {
    const binaryName = rustArtifactFileName({ name: "pmds", kind: "executable" });
    const sourcePath = target.rustTarget
      ? path.join(repoRoot, "target", target.rustTarget, profile, binaryName)
      : path.join(repoRoot, "target", profile, binaryName);
    const binDir = path.join(packageDir, "bin");
    const targetPath = path.join(binDir, binaryName);

    if (!existsSync(sourcePath)) {
      throw new Error(`Expected pmds binary at ${sourcePath}`);
    }

    mkdirSync(binDir, { recursive: true });
    copyFileSync(sourcePath, targetPath);
    const catalogDirectory = path.join(path.dirname(sourcePath), "pmds-locales");
    if (!existsSync(catalogDirectory)) {
      throw new Error(`Expected compiled CLI catalogs at ${catalogDirectory}`);
    }
    // Replace the generated asset directory so removed languages cannot linger
    // in a package assembled after an earlier build.
    rmSync(path.join(binDir, "pmds-locales"), { recursive: true, force: true });
    cpSync(catalogDirectory, path.join(binDir, "pmds-locales"), { recursive: true });
    if (process.platform !== "win32") {
      chmodSync(targetPath, 0o755);
    }
  },
});
