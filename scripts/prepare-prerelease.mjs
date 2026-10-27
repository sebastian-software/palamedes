import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { publicWorkspacePackages } from "./release-packages.mjs";
import { readReleasePolicy } from "./release-policy.mjs";
import { RUST_SDK_PACKAGES } from "./rust-sdk-packages.mjs";

export function assertPrereleaseVersion(version) {
  if (!/^2\.0\.0-(?:alpha|beta|rc)\.(?:0|[1-9]\d*)$/.test(version)) {
    throw new Error("Use an explicit 2.0.0-alpha.N, beta.N, or rc.N candidate version");
  }
}

/** Stage a committed candidate outside the checkout; never upload or lift its release hold. */
export function preparePrerelease(root, version, destination) {
  assertPrereleaseVersion(version);
  root = realpathSync(resolve(root));
  destination = join(realpathSync(dirname(resolve(destination))), basename(resolve(destination)));
  const relativeDestination = relative(root, destination);
  if (
    !relativeDestination ||
    (relativeDestination.split(sep)[0] !== ".." && !isAbsolute(relativeDestination))
  ) {
    throw new Error("The candidate must be outside the source checkout");
  }
  if (existsSync(destination)) throw new Error("Candidate destination already exists");
  const execute = (command, args, cwd = root) =>
    execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (execute("git", ["status", "--porcelain", "--untracked-files=no"]).trim()) {
    throw new Error("Commit tracked changes before preparing their candidate");
  }
  if (readReleasePolicy(root).publicationEnabled) {
    throw new Error("This preparation path requires the normal release hold");
  }
  execute(process.execPath, ["scripts/check-release-set.mjs"]);
  const sourceRevision = execute("git", ["rev-parse", "HEAD"]).trim();
  const sourceTree = execute("git", ["rev-parse", "HEAD^{tree}"]).trim();
  const metadata = JSON.parse(
    execute("cargo", ["metadata", "--no-deps", "--format-version", "1", "--locked"]),
  );
  const coordinated = metadata.packages.filter((pkg) =>
    [
      "palamedes",
      "palamedes-cli",
      "palamedes-node",
      "palamedes-plugin",
      ...RUST_SDK_PACKAGES,
    ].includes(pkg.name),
  );
  if (coordinated.length !== 6 || new Set(coordinated.map((pkg) => pkg.version)).size !== 1) {
    throw new Error("Expected six coordinated Rust packages at one source version");
  }
  const previousVersion = coordinated[0].version;
  mkdirSync(destination);
  const archive = join(destination, "source.tar");
  execute("git", ["archive", "--format=tar", `--output=${archive}`, sourceRevision]);
  execute("tar", ["-xf", archive, "-C", destination]);
  rmSync(archive);
  const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  for (const pkg of coordinated) {
    const manifest = join(destination, relative(root, pkg.manifest_path));
    writeFileSync(
      manifest,
      readFileSync(manifest, "utf8").replace(
        `version = "${previousVersion}"`,
        `version = "${version}"`,
      ),
    );
  }
  // Include the private example's registry/path requirements, without changing its own version.
  for (const pkg of metadata.packages.filter((pkg) =>
    metadata.workspace_members.includes(pkg.id),
  )) {
    const manifest = join(destination, relative(root, pkg.manifest_path));
    let text = readFileSync(manifest, "utf8");
    for (const dependency of coordinated) {
      const escapedName = dependency.name.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
      text = text.replace(
        new RegExp(
          `(^${escapedName}\\s*=\\s*\\{[^\\n]*?version\\s*=\\s*)"${previousVersion.replaceAll(".", "\\.")}"`,
          "gm",
        ),
        `$1"=${version}"`,
      );
    }
    if (RUST_SDK_PACKAGES.includes(pkg.name)) {
      if (!/^publish = false$/m.test(text))
        throw new Error(`Expected the source publish guard for ${pkg.name}`);
      text = text.replace(/^publish = false$/m, 'publish = ["crates-io"]');
    }
    writeFileSync(manifest, text);
  }
  for (const pkg of publicWorkspacePackages(destination)) {
    writeJson(join(destination, pkg.directory, "package.json"), { ...pkg.manifest, version });
  }
  writeJson(join(destination, ".release-please-manifest.json"), { ".": version });
  execute("cargo", ["update", "--workspace", "--offline"], destination);
  execute(
    "cargo",
    ["update", "--manifest-path", "fuzz/Cargo.toml", "--workspace", "--offline"],
    destination,
  );
  execute(process.execPath, ["scripts/check-release-set.mjs"], destination);
  const staged = JSON.parse(
    execute("cargo", ["metadata", "--no-deps", "--format-version", "1", "--locked"], destination),
  );
  const receipt = {
    sourceRevision,
    sourceTree,
    version,
    publicationEnabled: readReleasePolicy(destination).publicationEnabled,
    uploadsPerformed: false,
    readyForUpload: false,
    ferromarkRequirement: metadata.packages
      .find((pkg) => pkg.name === "palamedes")
      .dependencies.find((dep) => dep.name === "ferromark").req,
    cargo: RUST_SDK_PACKAGES.map((name) => ({
      name,
      version,
      publish: staged.packages.find((pkg) => pkg.name === name).publish,
    })),
    npm: publicWorkspacePackages(destination).map(({ name, nativeArtifact }) => ({
      name,
      version,
      nativeArtifact,
    })),
    next: "Run the existing Rust SDK proof and package/install tests; review archive checksums before authorizing any upload. This receipt alone is not package verification.",
  };
  writeJson(join(destination, "candidate.json"), receipt);
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 4)
    throw new Error("Usage: node scripts/prepare-prerelease.mjs VERSION NEW_DIRECTORY");
  console.log(
    JSON.stringify(preparePrerelease(process.cwd(), process.argv[2], process.argv[3]), null, 2),
  );
}
