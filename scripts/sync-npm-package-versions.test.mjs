import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readRootCargoVersion, syncNpmPackageVersions } from "./sync-npm-package-versions.mjs";

function fixtureRepository() {
  const root = mkdtempSync(path.join(os.tmpdir(), "palamedes-sync-npm-versions-"));
  writeFileSync(
    path.join(root, "Cargo.toml"),
    `[package]\nname = "fixture"\nversion = "2.0.0"\n\n[workspace.package]\nversion = "99.0.0"\n`,
  );

  const publicPackagePath = path.join(root, "packages", "public-package");
  const privatePackagePath = path.join(root, "packages", "private-package");
  mkdirSync(publicPackagePath, { recursive: true });
  mkdirSync(privatePackagePath, { recursive: true });
  writeFileSync(
    path.join(publicPackagePath, "package.json"),
    `${JSON.stringify({ name: "@fixture/public", version: "1.0.0", description: "preserved" }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(privatePackagePath, "package.json"),
    `${JSON.stringify({ name: "@fixture/private", version: "1.0.0", private: true }, null, 2)}\n`,
  );

  return { privatePackagePath, publicPackagePath, root };
}

test("reads the root package version rather than the workspace default", () => {
  const { root } = fixtureRepository();
  try {
    assert.equal(readRootCargoVersion(root), "2.0.0");
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("synchronizes public package versions, preserves other fields, and is idempotent", () => {
  const { privatePackagePath, publicPackagePath, root } = fixtureRepository();
  try {
    const first = syncNpmPackageVersions(readRootCargoVersion(root), root);
    assert.deepEqual(first, { packageCount: 1, updatedPackages: ["@fixture/public"] });
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(publicPackagePath, "package.json"), "utf8")),
      {
        name: "@fixture/public",
        version: "2.0.0",
        description: "preserved",
      },
    );
    assert.equal(
      JSON.parse(readFileSync(path.join(privatePackagePath, "package.json"), "utf8")).version,
      "1.0.0",
    );

    assert.deepEqual(syncNpmPackageVersions("2.0.0", root), {
      packageCount: 1,
      updatedPackages: [],
    });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("rejects non-stable versions before changing package manifests", () => {
  const { publicPackagePath, root } = fixtureRepository();
  const packageJsonPath = path.join(publicPackagePath, "package.json");
  const before = readFileSync(packageJsonPath, "utf8");
  try {
    assert.throws(() => syncNpmPackageVersions("2.0.0-rc.1", root), /stable semver/u);
    assert.equal(readFileSync(packageJsonPath, "utf8"), before);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
