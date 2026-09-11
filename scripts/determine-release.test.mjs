import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

const script = path.resolve(import.meta.dirname, "determine-release.mjs");

function fixtureRepository(subjects, { publicationEnabled = true, version = "2.0.0" } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "palamedes-determine-release-"));
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  writeFileSync(
    path.join(root, ".release-policy.json"),
    JSON.stringify({
      minimumMajor: 2,
      publicationEnabled,
      reason: "Await v2 release verification",
    }),
  );
  writeFileSync(path.join(root, ".release-please-manifest.json"), JSON.stringify({ ".": version }));
  for (const [index, subject] of subjects.entries()) {
    writeFileSync(path.join(root, `change-${index}`), subject);
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["-c", "commit.gpgSign=false", "commit", "-m", subject], { cwd: root });
  }
  return root;
}

function determine(root, env) {
  const output = path.join(root, "output");
  writeFileSync(output, "");
  execFileSync("node", [script], {
    cwd: root,
    stdio: "pipe",
    env: {
      ...process.env,
      FORCE_PUBLISH: "false",
      DRY_RUN: "false",
      GITHUB_OUTPUT: output,
      ...env,
    },
  });
  return readFileSync(output, "utf8");
}

test("determines release publication from force-publish and release commits", () => {
  const root = fixtureRepository(["feat: first", "chore: release 1.17.0"]);
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const base = execFileSync("git", ["rev-parse", "HEAD^"], { cwd: root, encoding: "utf8" }).trim();

  try {
    assert.equal(
      determine(root, { BASE_REF: base, GITHUB_EVENT_NAME: "push", GITHUB_SHA: sha }),
      "should_publish=true\n",
    );
    assert.equal(
      determine(root, { FORCE_PUBLISH: "true", GITHUB_EVENT_NAME: "workflow_dispatch" }),
      "should_publish=true\n",
    );
    assert.equal(
      determine(root, { BASE_REF: base, GITHUB_EVENT_NAME: "push", GITHUB_SHA: base }),
      "should_publish=false\n",
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("a release hold blocks release commits and forced publication, but permits a dry run", () => {
  const root = fixtureRepository(["feat: first", "chore: release 2.0.0"], {
    publicationEnabled: false,
  });
  try {
    const push = { BASE_REF: "HEAD^", GITHUB_SHA: "HEAD", GITHUB_EVENT_NAME: "push" };
    assert.equal(determine(root, push), "should_publish=false\n");
    assert.equal(determine(root, { ...push, DRY_RUN: "true" }), "should_publish=false\n");
    assert.equal(
      determine(root, { FORCE_PUBLISH: "true", GITHUB_EVENT_NAME: "workflow_dispatch" }),
      "should_publish=false\n",
    );
    assert.equal(
      determine(root, {
        FORCE_PUBLISH: "true",
        GITHUB_EVENT_NAME: "workflow_dispatch",
        DRY_RUN: "true",
      }),
      "should_publish=true\n",
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("even forced publication rejects 1.x, prerelease, and malformed versions after the hold is lifted", () => {
  for (const version of ["1.99.0", "2.0.0-beta.1", "invalid", null]) {
    const root = fixtureRepository(["feat: first"], { version });
    try {
      assert.throws(
        () => determine(root, { FORCE_PUBLISH: "true", GITHUB_EVENT_NAME: "workflow_dispatch" }),
        /Publication requires a stable version/,
      );
      assert.equal(readFileSync(path.join(root, "output"), "utf8"), "");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }
});

test("a missing or malformed release policy fails closed, including dry runs", () => {
  const root = fixtureRepository(["feat: first"]);
  try {
    const env = { FORCE_PUBLISH: "true", GITHUB_EVENT_NAME: "workflow_dispatch", DRY_RUN: "true" };
    for (const value of [
      "{",
      "null",
      JSON.stringify({ minimumMajor: 2, publicationEnabled: "false", reason: "hold" }),
    ]) {
      writeFileSync(path.join(root, ".release-policy.json"), value);
      assert.throws(() => determine(root, env));
      assert.equal(readFileSync(path.join(root, "output"), "utf8"), "");
    }
    rmSync(path.join(root, ".release-policy.json"));
    assert.throws(() => determine(root, env));
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
