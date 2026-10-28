import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const RUST_SDK_PACKAGES = ["palamedes-i18n", "palamedes", "palamedes-build"];
export const RUST_SDK_MANIFESTS = {
  "palamedes-i18n": "crates/palamedes-i18n/Cargo.toml",
  palamedes: "Cargo.toml",
  "palamedes-build": "crates/palamedes-build/Cargo.toml",
};
export const RUST_SDK_REPOSITORY = "https://github.com/sebastian-software/palamedes";

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "inherit"], ...options });
    const output = [];
    const errors = [];
    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr?.on("data", (chunk) => errors.push(chunk));
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      const stdout = Buffer.concat(output).toString();
      if (code === 0) resolve(stdout);
      else
        reject(
          new Error(
            `${command} ${args.join(" ")} failed (${signal ?? code})\n${stdout}\n${Buffer.concat(errors).toString()}`,
          ),
        );
    });
  });
}

export async function sdkMetadata(root) {
  const metadata = JSON.parse(
    await run("cargo", ["metadata", "--no-deps", "--format-version", "1", "--locked"], {
      cwd: root,
    }),
  );
  const packages = RUST_SDK_PACKAGES.map((name) => {
    const pkg = metadata.packages.find((entry) => entry.name === name);
    if (!pkg) throw new Error(`Missing Rust SDK package ${name}`);
    return pkg;
  });
  if (new Set(packages.map((pkg) => pkg.version)).size !== 1) {
    throw new Error("Rust SDK package versions must match the coordinated release version");
  }
  return packages;
}

// Reads `[package] version` without Cargo, for jobs that do not install Rust.
// check-release-set keeps these literal versions aligned with Cargo.lock.
export function cargoManifestVersion(manifest) {
  const section = /^\[package\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/mu.exec(manifest)?.[1] ?? "";
  const version = /^version\s*=\s*"([^"]+)"\s*$/mu.exec(section)?.[1];
  if (!version) throw new Error("Cargo manifest has no literal [package] version");
  return version;
}

export async function sdkManifestVersions(root) {
  return Promise.all(
    RUST_SDK_PACKAGES.map(async (name) => ({
      name,
      version: cargoManifestVersion(await readFile(join(root, RUST_SDK_MANIFESTS[name]), "utf8")),
    })),
  );
}

export function indexPath(name) {
  if (name.length === 1) return `1/${name}`;
  if (name.length === 2) return `2/${name}`;
  if (name.length === 3) return `3/${name[0]}/${name}`;
  return `${name.slice(0, 2)}/${name.slice(2, 4)}/${name}`;
}

export async function sha256(file) {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}

export function archivePath(target, pkg) {
  return join(target, "package", `${pkg.name}-${pkg.version}.crate`);
}

export function assertArchiveContents(name, files) {
  if (!RUST_SDK_PACKAGES.includes(name)) throw new Error(`Unknown Rust SDK package: ${name}`);
  const exact = new Set([
    ".cargo_vcs_info.json",
    "Cargo.toml",
    "Cargo.toml.orig",
    "Cargo.lock",
    "LICENSE-MIT",
    "LICENSE-APACHE",
    name === "palamedes" ? "crates/palamedes/README.md" : "README.md",
  ]);
  const prefixes =
    name === "palamedes"
      ? ["crates/palamedes/src/", "crates/palamedes/fixtures/"]
      : ["src/", "tests/"];
  const excludedDirectories = new Set([
    "node_modules",
    ".pnpm",
    ".git",
    "target",
    "dist",
    "build",
    "..",
  ]);
  for (const file of files) {
    if (
      file.split("/").some((part) => excludedDirectories.has(part)) ||
      (!exact.has(file) && !prefixes.some((prefix) => file.startsWith(prefix)))
    ) {
      throw new Error(`${name} archive contains an unexpected path: ${file}`);
    }
  }
  for (const required of [...exact].filter((file) => file !== ".cargo_vcs_info.json")) {
    if (!files.includes(required)) throw new Error(`${name} archive misses ${required}`);
  }
  if (!files.some((file) => file.startsWith(prefixes[0]) && file.endsWith(".rs"))) {
    throw new Error(`${name} archive has no Rust source files`);
  }
}

export async function readArchiveContents(archive, pkg, execute = run) {
  const prefix = `${pkg.name}-${pkg.version}/`;
  const files = (await execute("tar", ["-tzf", archive]))
    .trim()
    .split("\n")
    .map((path) => {
      if (!path.startsWith(prefix)) throw new Error(`Unexpected archive root: ${path}`);
      return path.slice(prefix.length);
    });
  assertArchiveContents(pkg.name, files);
  return files;
}

export async function registryJson(url, { fetchImpl = fetch, headers = {} } = {}) {
  const response = await fetchImpl(url, {
    headers: { "User-Agent": "Palamedes-Rust-SDK-release", ...headers },
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Registry request failed: HTTP ${response.status} at ${url}`);
  return response.json();
}

export async function waitForRegistryVersion(
  pkg,
  checksum,
  {
    fetchImpl = fetch,
    pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    attempts = 8,
  } = {},
) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const response = await fetchImpl(`https://index.crates.io/${indexPath(pkg.name)}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status !== 404 && !response.ok) {
      throw new Error(`Registry index failed: HTTP ${response.status} for ${pkg.name}`);
    }
    if (response.ok) {
      const entry = (await response.text())
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .find((item) => item.vers === pkg.version);
      if (entry) {
        // A null checksum accepts any archive; the publisher passes the exact one.
        if (entry.yanked || (checksum !== null && entry.cksum !== checksum)) {
          throw new Error(`Registry content differs or is yanked: ${pkg.name}@${pkg.version}`);
        }
        return;
      }
    }
    if (attempt + 1 < attempts) await pause(15_000);
  }
  throw new Error(`Registry propagation timed out for ${pkg.name}@${pkg.version}`);
}
