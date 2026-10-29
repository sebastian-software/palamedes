import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const browserRuntimeProfiles = ["core", "react", "solid", "remix"];

// package.json fields that describe or publish a package but never reach its
// unbuild output or the measured browser bundle. `version` is the one a
// release bump rewrites; the rest are dropped so metadata edits do not force a
// report regeneration either. Every other field stays hashed: name, type,
// sideEffects, main/module/types, exports and imports select entries and
// tree-shaking; scripts pick the build tool; engines can set a bundler's
// target; and dependency names decide what unbuild externalizes. Dependency
// ranges stay too, but resolved versions come from the lockfiles below.
export const packageMetadataFields = [
  "version",
  "description",
  "keywords",
  "homepage",
  "bugs",
  "license",
  "repository",
  "author",
  "contributors",
  "funding",
  "files",
  "publishConfig",
];

export function normalizePackageJson(text) {
  const manifest = JSON.parse(text);
  for (const field of packageMetadataFields) delete manifest[field];
  return JSON.stringify(manifest);
}

// Cargo.lock records workspace crates (and any other path crate) without a
// `source` line, so the lockfile itself names the crates a release bump
// rewrites; no crate list is kept here, and the test cross-checks it against
// `cargo metadata --no-deps`. Their own versions are dropped, together with
// "name version" references that Cargo only writes when a name is ambiguous.
// Their dependency lists and every external package stay hashed.
export function normalizeCargoLock(text) {
  const blocks = text.split(/(?=^\[\[package\]\]$)/mu);
  const local = [];
  const normalized = blocks.map((block) => {
    if (!block.startsWith("[[package]]") || /^source = /mu.test(block)) return block;
    const name = /^name = "([^"]+)"$/mu.exec(block)?.[1];
    const version = /^version = "([^"]+)"$/mu.exec(block)?.[1];
    if (name && version) local.push(`${name} ${version}`);
    return block.replace(/^version = "[^"]*"\n/mu, "");
  });
  let result = normalized.join("");
  for (const reference of local)
    result = result.replaceAll(`"${reference}"`, `"${reference.split(" ")[0]}"`);
  return result;
}

// pnpm-lock.yaml needs no projection: workspace packages appear only as
// `link:` importers with `workspace:` specifiers, and release-please only
// rewrites package.json `version` fields, so a bump leaves the file unchanged.
export function normalizeCargoManifest(text) {
  // Release versions do not change compiled catalog semantics. Keep external
  // requirements and build/profile/toolchain settings in the fingerprint.
  return text
    .replace(/^(version\s*=\s*)"[^"]+"/mu, '$1"<release>"')
    .replace(
      /^(palamedes[\w-]*\s*=\s*\{[^\n]*version\s*=\s*)"[^"]+"(?=[^\n]*path\s*=)/gmu,
      '$1"<release>"',
    );
}

export function buildBrowserRuntimeCompiler(root, run = execFileSync) {
  run(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    ["--recursive", "--filter", "@palamedes/core-node...", "build"],
    { cwd: root, stdio: "inherit", shell: process.platform === "win32" },
  );
}

export function normalizeSourceInput(filename, bytes) {
  if (path.basename(filename) === "package.json")
    return normalizePackageJson(bytes.toString("utf8"));
  if (path.basename(filename) === "Cargo.toml")
    return normalizeCargoManifest(bytes.toString("utf8"));
  if (filename === "Cargo.lock") return normalizeCargoLock(bytes.toString("utf8"));
  return bytes;
}

// Unit and type-test files sit next to the sources but are never a build
// entry, so they cannot reach the measured bytes. Excluding them keeps a PR
// that only adds or edits a test from invalidating the report. Real sources
// whose names merely contain "test" (for example `server-test.ts`) do not match.
const testFilePattern = /\.(?:test|type-test)\.[cm]?[jt]sx?$/u;
// Rust test modules live in separate files that their parent declares behind
// `#[cfg(test)]` (`tests.rs`, `test_support.rs`, `tests/` directories, and
// `*_test.rs`/`*_tests.rs`), so a release build of the addon never compiles them.
const rustTestFilePattern = /(?:^|\/)(?:tests\/.*|tests\.rs|test_support\.rs|[^/]+_tests?\.rs)$/u;
export const isBrowserRuntimeTestFile = (filename) =>
  testFilePattern.test(filename) || rustTestFilePattern.test(filename);
// Documentation next to the sources (for example a crate README) is never
// compiled or bundled.
export const isBrowserRuntimeIgnoredFile = (filename) =>
  isBrowserRuntimeTestFile(filename) || filename.endsWith(".md");

export function browserRuntimeInputPaths(root) {
  const lsFiles = (...paths) =>
    execFileSync("git", ["ls-files", ...paths], { cwd: root, encoding: "utf8" })
      .trim()
      .split("\n")
      .filter((filename) => !isBrowserRuntimeIgnoredFile(filename));
  // Hash source inputs, not generated dist directories. A fresh package build
  // is required before measuring. The report separately retains every bundled
  // input.
  return [
    ...[...browserRuntimeProfiles, "runtime"].flatMap((id) =>
      lsFiles(
        `packages/${id}/src`,
        `packages/${id}/build.config.ts`,
        `packages/${id}/package.json`,
      ),
    ),
    // The native compiler: the `palamedes` crate (root Cargo.toml) and the
    // Node addon crate. `crates/palamedes/fixtures` only feeds `#[cfg(test)]`
    // modules through `include_str!`, so it is not an input.
    ...lsFiles("crates/palamedes/src", "crates/palamedes-node"),
    "Cargo.toml",
    "rust-toolchain.toml",
    "packages/core-node/scripts/build-native.mjs",
    "scripts/build-native-lib.mjs",
    ...lsFiles(
      "packages/core-node/src",
      "packages/core-node/build.config.ts",
      "packages/core-node/package.json",
    ),
    "Cargo.lock",
    "pnpm-lock.yaml",
    "scripts/benchmark-browser-runtime.mjs",
    "scripts/browser-runtime-source-hash.mjs",
    ...browserRuntimeProfiles.map((id) => `benchmarks/browser-runtime/${id}.mjs`),
    ...browserRuntimeProfiles.map((id) => `benchmarks/browser-runtime/${id}-client.mjs`),
    "benchmarks/browser-runtime/catalog-only.mjs",
    "proof/sveltekit-ssr/locales/en.po",
  ].sort();
}

export async function browserRuntimeSourceSha256(
  root,
  {
    inputPaths = browserRuntimeInputPaths(root),
    read = (filename) => readFile(path.join(root, filename)),
  } = {},
) {
  const hash = createHash("sha256");
  for (const filename of inputPaths) {
    hash
      .update(filename)
      .update("\0")
      .update(normalizeSourceInput(filename, await read(filename)))
      .update("\0");
  }
  return hash.digest("hex");
}
