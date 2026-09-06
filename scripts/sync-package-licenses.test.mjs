import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";

import { publicWorkspacePackages } from "./release-packages.mjs";
import { LICENSE_FILES, missingLicenseFileEntries } from "./sync-package-licenses.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

test("the repository carries both license texts of the declared dual license", () => {
  for (const licenseFile of LICENSE_FILES) {
    assert.equal(existsSync(path.join(repositoryRoot, licenseFile)), true, licenseFile);
  }
});

test("every publishable package declares the dual license and ships both texts", () => {
  const packages = publicWorkspacePackages(repositoryRoot);

  assert.ok(packages.length > 0);

  for (const packageInfo of packages) {
    assert.equal(
      packageInfo.manifest.license,
      "MIT OR Apache-2.0",
      `${packageInfo.name} declares an unexpected license`,
    );
    // Packing tools only force-include a `license{,.*}` file, so a package that
    // does not list the two texts publishes without them.
    assert.deepEqual(
      missingLicenseFileEntries(packageInfo.manifest),
      [],
      `${packageInfo.name} does not ship its license texts`,
    );
  }
});
