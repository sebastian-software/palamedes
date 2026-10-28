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

test("the generated 2.0.0 release PR fails until it drops last-release-sha", () => {
  // The release PR bumps only the manifest; the config keeps the overrides.
  const transitionConfig = {
    "last-release-sha": "294295b4",
    packages: { ".": { "release-type": "rust", "release-as": "2.0.0" } },
  };
  assert.equal(overrides(transitionConfig, "2.0.0").length, 1);
  assert.deepEqual(
    overrides({ packages: { ".": { "release-type": "rust", "release-as": "2.0.0" } } }, "2.0.0"),
    [],
  );
});
