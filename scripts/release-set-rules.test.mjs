import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  exactPinProblems,
  lookupReleaseState,
  releaseOverrideProblems,
  releaseTagName,
  releaseTagState,
} from "./release-set-rules.mjs";

const root = path.resolve(import.meta.dirname, "..");
const readRepositoryFile = (file) => readFileSync(path.join(root, file), "utf8");

// The transition config as it sits on main until the 2.0.0 release ships.
const transitionConfig = {
  "include-component-in-tag": true,
  "tag-separator": "-",
  "last-release-sha": "294295b4",
  packages: { ".": { "release-type": "rust", "release-as": "2.0.0", component: "palamedes" } },
};

function overrides(releaseConfig, manifestVersion, releaseState = "unreleased") {
  return releaseOverrideProblems({
    releaseConfig,
    manifestVersion,
    minimumMajor: 2,
    releaseState,
  });
}

test("names the release tag the way release-please does", () => {
  assert.equal(releaseTagName(transitionConfig, "2.0.0"), "palamedes-v2.0.0");
  assert.equal(
    releaseTagName(JSON.parse(readRepositoryFile(".release-please-config.json")), "1.25.1"),
    "palamedes-v1.25.1",
  );
});

test("classifies the commit against the manifest version's release tag", () => {
  assert.equal(releaseTagState({ readable: true, headCommit: "a" }), "unreleased");
  // The release commit itself carries the tag once release-please creates it.
  assert.equal(releaseTagState({ readable: true, tagCommit: "a", headCommit: "a" }), "unreleased");
  assert.equal(releaseTagState({ readable: true, tagCommit: "a", headCommit: "b" }), "released");
  assert.equal(releaseTagState({ readable: false }), "unknown");
});

test("accepts both overrides while main waits for the 2.0.0 release PR", () => {
  // palamedes-v1.25.1 exists, so the 1.25.1 manifest counts as released.
  assert.deepEqual(overrides(transitionConfig, "1.25.1", "released"), []);
});

test("accepts both overrides in the generated release PR and on the release commit", () => {
  // The release PR bumps only the manifest, and release-please rebuilds and
  // force-pushes its branch from main's config, so the overrides stay.
  assert.deepEqual(overrides(transitionConfig, "2.0.0", "unreleased"), []);
});

test("fails after the release until a follow-up PR removes both overrides", () => {
  const problems = overrides(transitionConfig, "2.0.0", "released");
  assert.equal(problems.length, 2);
  assert.match(
    problems[0],
    /release-as 2\.0\.0 at packages\["\."\] was released as palamedes-v2\.0\.0/u,
  );
  assert.match(problems[1], /remove it now that palamedes-v2\.0\.0 exists/u);
  // A later version on main, with the stale overrides still in place.
  assert.equal(overrides(transitionConfig, "2.1.0", "released").length, 2);

  const { "last-release-sha": _sha, ...cleaned } = transitionConfig;
  const { "release-as": _target, ...rootPackage } = cleaned.packages["."];
  assert.deepEqual(
    overrides({ ...cleaned, packages: { ".": rootPackage } }, "2.0.0", "released"),
    [],
  );
});

test("skips the post-release checks when the tags cannot be read", () => {
  assert.deepEqual(overrides(transitionConfig, "2.0.0", "unknown"), []);
});

test("rejects release-as targets that can never be right", () => {
  assert.match(
    overrides({ "release-as": "1.25.0", packages: { ".": {} } }, "1.25.1")[0],
    /release-as 1\.25\.0 at the top level is below the manifest version 1\.25\.1/u,
  );
  assert.deepEqual(
    overrides({ packages: { ".": { "release-as": "2.0.1" } } }, "2.0.0", "released"),
    [],
  );
  assert.match(
    overrides({ packages: { ".": { "release-as": "2.0.0-rc.1" } } }, "1.25.1")[0],
    /must be a stable version/u,
  );
});

test("keeps last-release-sha at the top level, where release-please reads it", () => {
  assert.match(
    overrides({ packages: { ".": { "last-release-sha": "294295b4" } } }, "1.25.1")[0],
    /must sit at the top level/u,
  );
});

test("reads lightweight and annotated release tags from the remote", (t) => {
  const scratch = mkdtempSync(path.join(os.tmpdir(), "palamedes-release-tags-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const git = (cwd, ...args) =>
    execFileSync("git", ["-c", "commit.gpgSign=false", "-c", "tag.gpgSign=false", ...args], {
      cwd,
      encoding: "utf8",
    }).trim();
  const remote = path.join(scratch, "remote.git");
  const work = path.join(scratch, "work");
  git(scratch, "init", "--quiet", "--bare", remote);
  git(scratch, "init", "--quiet", "--initial-branch=main", work);
  git(work, "config", "user.email", "test@example.com");
  git(work, "config", "user.name", "Test");
  writeFileSync(path.join(work, "file"), "release\n");
  git(work, "add", ".");
  git(work, "commit", "--quiet", "-m", "chore: release main");
  const releaseCommit = git(work, "rev-parse", "HEAD");
  git(work, "tag", "palamedes-v2.0.0");
  git(work, "tag", "-a", "-m", "annotated", "palamedes-v2.0.0-annotated");
  git(work, "push", "--quiet", remote, "main", "--tags");
  // Only the remote knows the tags, like a shallow CI checkout.
  git(work, "tag", "-d", "palamedes-v2.0.0", "palamedes-v2.0.0-annotated");

  const lookup = (tag) => lookupReleaseState({ root: work, remote, tag }).state;
  assert.equal(lookup("palamedes-v2.0.0"), "unreleased");
  assert.equal(lookup("palamedes-v2.0.0-annotated"), "unreleased");
  assert.equal(lookup("palamedes-v2.0.1"), "unreleased");

  writeFileSync(path.join(work, "file"), "later\n");
  git(work, "commit", "--quiet", "-am", "fix: later change");
  assert.notEqual(git(work, "rev-parse", "HEAD"), releaseCommit);
  assert.equal(lookup("palamedes-v2.0.0"), "released");
  assert.equal(lookup("palamedes-v2.0.0-annotated"), "released");
  // A prefix match such as palamedes-v2.0.0-annotated must not count as v2.0.
  assert.equal(lookup("palamedes-v2.0"), "unreleased");

  const missing = lookupReleaseState({ root: work, remote: path.join(scratch, "nope"), tag: "x" });
  assert.equal(missing.state, "unknown");
  assert.match(missing.error, /could not read x from/u);
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
