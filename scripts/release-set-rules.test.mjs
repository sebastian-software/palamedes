import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { exactPinProblems, releaseOverrideProblems } from "./release-set-rules.mjs";

const root = path.resolve(import.meta.dirname, "..");
const readRepositoryFile = (file) => readFileSync(path.join(root, file), "utf8");

function overrides(releaseConfig, manifestVersion) {
  return releaseOverrideProblems({ releaseConfig, manifestVersion, minimumMajor: 2 });
}

test("accepts the pending 2.0.0 transition with both one-time overrides", () => {
  assert.deepEqual(
    overrides(
      { "last-release-sha": "294295b4", packages: { ".": { "release-as": "2.0.0" } } },
      "1.25.1",
    ),
    [],
  );
});

test("rejects a release-as override that is not above the manifest version", () => {
  for (const manifestVersion of ["2.0.0", "2.1.0"]) {
    const [problem, ...rest] = overrides(
      { packages: { ".": { "release-as": "2.0.0" } } },
      manifestVersion,
    );
    assert.match(problem, /release-as 2\.0\.0 at packages\["\."\] is not above/u);
    assert.deepEqual(rest, []);
  }
  assert.match(
    overrides({ "release-as": "1.25.1", packages: { ".": {} } }, "1.25.1")[0],
    /release-as 1\.25\.1 at the top level is not above/u,
  );
  assert.deepEqual(overrides({ packages: { ".": { "release-as": "2.0.1" } } }, "2.0.0"), []);
  assert.match(
    overrides({ packages: { ".": { "release-as": "2.0.0-rc.1" } } }, "1.25.1")[0],
    /must be a stable version/u,
  );
});

test("requires removing last-release-sha once the manifest reaches the minimum major", () => {
  const [problem, ...rest] = overrides(
    { "last-release-sha": "294295b4", packages: { ".": {} } },
    "2.0.0",
  );
  assert.match(problem, /remove it now that the manifest is at 2\.0\.0/u);
  assert.deepEqual(rest, []);
  assert.equal(
    overrides({ "last-release-sha": "294295b4", packages: { ".": {} } }, "2.3.1").length,
    1,
  );
});

test("keeps last-release-sha at the top level, where release-please reads it", () => {
  assert.match(
    overrides({ packages: { ".": { "last-release-sha": "294295b4" } } }, "1.25.1")[0],
    /must sit at the top level/u,
  );
});

test("the generated 2.0.0 release PR fails until it drops both overrides", () => {
  // The release PR bumps only the manifest; the config keeps the overrides.
  const transitionConfig = {
    "last-release-sha": "294295b4",
    packages: { ".": { "release-type": "rust", "release-as": "2.0.0" } },
  };
  assert.equal(overrides(transitionConfig, "2.0.0").length, 2);
  assert.deepEqual(overrides({ packages: { ".": { "release-type": "rust" } } }, "2.0.0"), []);
});

const pinnedRootCargo = (version, marker = " # x-release-please-version") =>
  `[workspace]\nmembers = []\n\n[workspace.dependencies]\n# comment\npalamedes-i18n = { version = "=${version}", path = "crates/palamedes-i18n" }${marker}\n\n[profile.release]\n`;
const inheritingBuildCargo =
  '[package]\nname = "palamedes-build"\n\n[dependencies]\npalamedes-i18n = { workspace = true }\n';
const genericExtraFile = [{ type: "generic", path: "Cargo.toml" }];

function pins(overridesForCase = {}) {
  return exactPinProblems({
    rootCargo: pinnedRootCargo("1.25.1"),
    buildCargo: inheritingBuildCargo,
    version: "1.25.1",
    extraFiles: genericExtraFile,
    ...overridesForCase,
  });
}

test("accepts an exact workspace pin at the release version", () => {
  assert.deepEqual(pins(), []);
});

test("rejects a pin that drifted from the workspace version", () => {
  assert.deepEqual(pins({ rootCargo: pinnedRootCargo("1.25.0") }), [
    "the exact palamedes-i18n pin is =1.25.0, expected =1.25.1",
  ]);
});

test("rejects a caret requirement or a missing pin", () => {
  assert.match(
    pins({
      rootCargo:
        '[workspace.dependencies]\npalamedes-i18n = { version = "1.25.1", path = "crates/palamedes-i18n" } # x-release-please-version\n',
    })[0],
    /must pin palamedes-i18n/u,
  );
  assert.match(pins({ rootCargo: "[workspace]\n" })[0], /must pin palamedes-i18n/u);
});

test("rejects a pin release-please would not bump", () => {
  assert.match(pins({ rootCargo: pinnedRootCargo("1.25.1", "") })[0], /x-release-please-version/u);
  assert.match(pins({ extraFiles: [] })[0], /exactly one generic entry for Cargo\.toml/u);
  assert.match(
    pins({ extraFiles: [{ type: "generic", path: "**/Cargo.toml", glob: true }] })[0],
    /exactly one generic entry/u,
  );
});

test("rejects palamedes-build declaring its own palamedes-i18n requirement", () => {
  assert.match(
    pins({
      buildCargo:
        '[dependencies]\npalamedes-i18n = { version = "=1.25.1", path = "../palamedes-i18n" }\n',
    })[0],
    /inherit palamedes-i18n with \{ workspace = true \}/u,
  );
});

test("the repository pins palamedes-i18n exactly at the workspace version", () => {
  const rootCargo = readRepositoryFile("Cargo.toml");
  const releaseConfig = JSON.parse(readRepositoryFile(".release-please-config.json"));
  assert.deepEqual(
    exactPinProblems({
      rootCargo,
      buildCargo: readRepositoryFile("crates/palamedes-build/Cargo.toml"),
      version: /^version = "([^"]+)"/mu.exec(rootCargo)[1],
      extraFiles: releaseConfig.packages["."]["extra-files"],
    }),
    [],
  );
});
