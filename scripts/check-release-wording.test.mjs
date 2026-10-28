import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  PRERELEASE_WORDING_PHRASES,
  RELEASE_WORDING_FILES,
  findPrereleaseWording,
} from "./check-release-wording.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts", "check-release-wording.mjs");

function currentFiles() {
  return Object.fromEntries(
    RELEASE_WORDING_FILES.map((file) => [file, readFileSync(path.join(root, file), "utf8")]),
  );
}

test("skips while the release version is below 2.0.0", () => {
  const files = { "docs/sample.md": "Publication remains held.\n" };

  assert.deepEqual(findPrereleaseWording({ version: "1.25.1", files }), {
    status: "skipped",
    version: "1.25.1",
    hits: [],
  });
});

test("reports each phrase with its file and line once the version reaches 2.0.0", () => {
  const files = {
    "docs/sample.md": "# Title\n\nPublication remains held; read the notes.\nClean line.\n",
  };

  const result = findPrereleaseWording({ version: "2.0.0", files });

  assert.equal(result.status, "failed");
  assert.deepEqual(result.hits, [
    { file: "docs/sample.md", line: 3, phrase: "Publication remains held" },
  ]);
});

test("matches phrases case-insensitively", () => {
  const files = { "docs/sample.md": "THE UNRELEASED PALAMEDES V2 IS WAITING.\n" };

  const result = findPrereleaseWording({ version: "2.0.0", files });

  assert.deepEqual(result.hits, [
    { file: "docs/sample.md", line: 1, phrase: "unreleased Palamedes v2" },
  ]);
});

test("passes clean 2.0.0 text", () => {
  const files = {
    "docs/sample.md": "Palamedes 2.0 is generally available.\nInstall the latest release.\n",
  };

  assert.deepEqual(findPrereleaseWording({ version: "2.0.0", files }), {
    status: "ok",
    version: "2.0.0",
    hits: [],
  });
});

test("gates later majors and treats a 2.0.0 prerelease as below the gate", () => {
  const files = { "docs/sample.md": "Draft for the planned 2.0 release.\n" };

  assert.equal(findPrereleaseWording({ version: "3.1.0", files }).status, "failed");
  assert.equal(findPrereleaseWording({ version: "2.0.0-rc.1", files }).status, "skipped");
});

test("finds the current pre-release wording in the v2 release notes", () => {
  const result = findPrereleaseWording({ version: "2.0.0", files: currentFiles() });

  assert.equal(result.status, "failed");
  assert.ok(
    result.hits.some(
      (hit) =>
        hit.file === "docs/release-notes-v2.md" && hit.phrase === "Draft for the planned 2.0",
    ),
  );
});

test("keeps every listed phrase tied to text that exists today", () => {
  const { hits } = findPrereleaseWording({ version: "2.0.0", files: currentFiles() });

  for (const phrase of PRERELEASE_WORDING_PHRASES) {
    assert.ok(
      hits.some((hit) => hit.phrase === phrase),
      `no current file matches "${phrase}"`,
    );
  }
});

test("prints a skip line and exits 0 while the manifest is below 2.0.0", () => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "palamedes-release-wording-"));
  writeFileSync(
    path.join(fixture, ".release-please-manifest.json"),
    JSON.stringify({ ".": "1.25.1" }),
  );

  const output = execFileSync(process.execPath, [script], { cwd: fixture, encoding: "utf8" });

  assert.equal(output.trim(), "skipped: version 1.25.1 < 2.0.0");
  rmSync(fixture, { recursive: true, force: true });
});
