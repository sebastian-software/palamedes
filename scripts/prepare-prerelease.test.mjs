import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { assertPrereleaseVersion, preparePrerelease } from "./prepare-prerelease.mjs";

test("candidate preparation accepts explicit v2 prereleases and rejects stable versions and shell text", () => {
  for (const version of ["2.0.0-alpha.1", "2.0.0-beta.0", "2.0.0-rc.12"]) {
    assert.doesNotThrow(() => assertPrereleaseVersion(version));
  }
  for (const version of [
    "1.25.1",
    "2.0.0",
    "2.0.1-alpha.1",
    "2.0.0-alpha.01",
    "2.0.0-alpha.1;pwd",
  ]) {
    assert.throws(() => assertPrereleaseVersion(version), /explicit/);
  }
});

test("candidate preparation preserves existing directories and refuses paths inside the checkout", () => {
  const directory = mkdtempSync(join(tmpdir(), "palamedes-candidate-guard-"));
  try {
    const source = join(directory, "source");
    const existing = join(directory, "existing");
    mkdirSync(source);
    mkdirSync(existing);
    writeFileSync(join(existing, "sentinel"), "preserved");
    for (const output of [source, join(source, "candidate"), join(source, "..looks-outside")]) {
      assert.throws(() => preparePrerelease(source, "2.0.0-alpha.1", output), /outside/);
    }
    assert.throws(() => preparePrerelease(source, "2.0.0-alpha.1", existing), /already exists/);
    assert.equal(readFileSync(join(existing, "sentinel"), "utf8"), "preserved");
    if (process.platform !== "win32") {
      const alias = join(directory, "alias");
      symlinkSync(source, alias);
      assert.throws(
        () => preparePrerelease(source, "2.0.0-alpha.1", join(alias, "candidate")),
        /outside/,
      );
    }
  } finally {
    rmSync(directory, { recursive: true });
  }
});
