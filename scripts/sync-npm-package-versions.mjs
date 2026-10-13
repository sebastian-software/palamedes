import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { publicWorkspacePackages } from "./release-packages.mjs";

const STABLE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;

export function readRootCargoVersion(root = process.cwd()) {
  const cargoManifest = readFileSync(path.join(root, "Cargo.toml"), "utf8");
  let inPackageSection = false;

  for (const line of cargoManifest.split(/\r?\n/u)) {
    if (line.trim() === "[package]") {
      inPackageSection = true;
      continue;
    }

    if (inPackageSection && /^\s*\[/u.test(line)) {
      break;
    }

    if (!inPackageSection) {
      continue;
    }

    const version = /^\s*version\s*=\s*"([^"]+)"\s*$/u.exec(line)?.[1];
    if (version) {
      return version;
    }
  }

  throw new Error("The root Cargo.toml [package] section has no literal version.");
}

function replaceTopLevelVersion(source, currentVersion, nextVersion, packageName) {
  const nameIndent = /^([\t ]*)"name"[\t ]*:/mu.exec(source)?.[1];
  if (nameIndent === undefined) {
    throw new Error(`${packageName} has no formatted top-level name field.`);
  }

  const escapedIndent = nameIndent.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const versionLine = new RegExp(
    `^${escapedIndent}"version"[\\t ]*:[\\t ]*"([^"]+)"([\\t \\r]*,?[\\t \\r]*)$`,
    "mu",
  );
  const match = versionLine.exec(source);

  if (!match || match[1] !== currentVersion) {
    throw new Error(`${packageName} has no matching formatted top-level version field.`);
  }

  return `${source.slice(0, match.index)}${nameIndent}"version": ${JSON.stringify(nextVersion)}${match[2]}${source.slice(match.index + match[0].length)}`;
}

export function syncNpmPackageVersions(version, root = process.cwd()) {
  if (typeof version !== "string" || !STABLE_VERSION_PATTERN.test(version)) {
    throw new TypeError(`Expected a stable semver version, found ${String(version)}.`);
  }

  const packages = publicWorkspacePackages(root);
  if (packages.length === 0) {
    throw new Error("No public workspace packages were found to synchronize.");
  }

  const updatedPackages = [];

  for (const packageInfo of packages) {
    if (packageInfo.version === version) {
      continue;
    }

    if (typeof packageInfo.version !== "string") {
      throw new TypeError(`${packageInfo.name} has no package version.`);
    }

    const packagePath = path.join(root, packageInfo.directory, "package.json");
    const source = readFileSync(packagePath, "utf8");
    const updated = replaceTopLevelVersion(source, packageInfo.version, version, packageInfo.name);
    writeFileSync(packagePath, updated);
    updatedPackages.push(packageInfo.name);
  }

  return { packageCount: packages.length, updatedPackages };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = readRootCargoVersion();
  const { packageCount, updatedPackages } = syncNpmPackageVersions(version);
  console.log(
    `sync-npm-package-versions: ${updatedPackages.length}/${packageCount} public packages set to ${version}`,
  );
}
