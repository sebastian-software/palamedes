import assert from "node:assert/strict";
import test from "node:test";

import { releaseOverrideProblems } from "./release-set-rules.mjs";

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
