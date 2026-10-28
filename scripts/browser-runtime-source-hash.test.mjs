import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  browserRuntimeInputPaths,
  browserRuntimeSourceSha256,
  isBrowserRuntimeTestFile,
  normalizeCargoLock,
} from "./browser-runtime-source-hash.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const inputPaths = browserRuntimeInputPaths(root);
const readInput = (filename) => readFile(path.join(root, filename));
const hashWith = (edit) =>
  browserRuntimeSourceSha256(root, {
    inputPaths,
    async read(filename) {
      const bytes = await readInput(filename);
      const edited = edit(filename, bytes.toString("utf8"));
      return edited === undefined ? bytes : Buffer.from(edited);
    },
  });
const baseline = await hashWith(() => {});

// The rewrite release-please performs: `$.version` in every package.json and
// the workspace crate versions in Cargo.lock. The target must differ from every
// real version, including on the release PR branch itself.
const BUMPED_VERSION = "999.0.0";
const bumpVersions = (filename, text) => {
  if (path.basename(filename) === "package.json") {
    const bumped = text.replace(/^( {2}"version": )"[^"]*"/mu, `$1"${BUMPED_VERSION}"`);
    assert.ok(bumped !== text, `${filename} has a version to bump`);
    return bumped;
  }
  if (filename === "Cargo.lock") {
    const bumped = text
      .split(/(?=^\[\[package\]\]$)/mu)
      .map((block) =>
        block.startsWith("[[package]]") && !/^source = /mu.test(block)
          ? block.replace(/^version = "[^"]*"$/mu, `version = "${BUMPED_VERSION}"`)
          : block,
      )
      .join("");
    assert.ok(bumped !== text, `${filename} was edited`);
    return bumped;
  }
};

test("a release version bump keeps the source hash", async () => {
  assert.ok(inputPaths.filter((filename) => filename.endsWith("package.json")).length >= 5);
  assert.equal(await hashWith(bumpVersions), baseline);
});

test("publish-only package.json metadata does not change the source hash", async () => {
  assert.equal(
    await hashWith((filename, text) =>
      filename === "packages/core/package.json"
        ? JSON.stringify({ ...JSON.parse(text), description: "Edited", keywords: [] }, null, 4)
        : undefined,
    ),
    baseline,
  );
});

test("build-relevant package.json fields change the source hash", async () => {
  for (const edit of [
    (manifest) => ({ ...manifest, sideEffects: true }),
    (manifest) => ({ ...manifest, exports: { ...manifest.exports, "./extra": "./dist/x.mjs" } }),
    (manifest) => ({
      ...manifest,
      dependencies: { ...manifest.dependencies, "left-pad": "^1.0.0" },
    }),
  ])
    assert.notEqual(
      await hashWith((filename, text) =>
        filename === "packages/react/package.json"
          ? JSON.stringify(edit(JSON.parse(text)), null, 2)
          : undefined,
      ),
      baseline,
    );
});

test("a runtime source edit changes the source hash", async () => {
  const source = inputPaths.find((filename) => filename.startsWith("packages/runtime/src/"));
  assert.ok(source);
  assert.notEqual(
    await hashWith((filename, text) => (filename === source ? `${text}\n// edit\n` : undefined)),
    baseline,
  );
});

test("unit and type-test files are not hash inputs, but test-named sources are", () => {
  for (const filename of [
    "packages/remix/src/index.test.ts",
    "packages/react/src/index.test.tsx",
    "packages/remix/src/macro.type-test.tsx",
  ])
    assert.ok(isBrowserRuntimeTestFile(filename), filename);
  for (const filename of [
    "packages/runtime/src/server-test.ts",
    "packages/runtime/src/server-test-unavailable.ts",
    "packages/runtime/src/index.ts",
  ])
    assert.ok(!isBrowserRuntimeTestFile(filename), filename);
  assert.deepEqual(inputPaths.filter(isBrowserRuntimeTestFile), []);
  assert.ok(inputPaths.includes("packages/runtime/src/server-test.ts"));
});

test("an external dependency version in a lockfile changes the source hash", async () => {
  const cargoLock = await hashWith((filename, text) => {
    if (filename !== "Cargo.lock") return;
    const bumped = text.replace(
      /(^\[\[package\]\]\nname = "[^"]+"\nversion = ")([^"]+)("\nsource = )/mu,
      "$19.9.9$3",
    );
    assert.ok(bumped !== text, `${filename} was edited`);
    return bumped;
  });
  assert.notEqual(cargoLock, baseline);

  const pnpmLock = await hashWith((filename, text) => {
    if (filename !== "pnpm-lock.yaml") return;
    // The first external importer resolution, e.g. `version: 1.62.1`.
    const bumped = text.replace(/^( {8}version: )\d[^\s(]*/mu, "$19.9.9");
    assert.ok(bumped !== text, `${filename} was edited`);
    return bumped;
  });
  assert.notEqual(pnpmLock, baseline);
});

test("Cargo.lock entries without a source are exactly the workspace crates", (t) => {
  let metadata;
  try {
    metadata = JSON.parse(
      execFileSync("cargo", ["metadata", "--no-deps", "--format-version", "1", "--offline"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
  } catch {
    t.skip("cargo is unavailable");
    return;
  }
  const workspace = metadata.packages.map(({ name }) => name).sort();
  const lock = execFileSync("git", ["show", "HEAD:Cargo.lock"], { cwd: root, encoding: "utf8" });
  const local = lock
    .split(/(?=^\[\[package\]\]$)/mu)
    .filter((block) => block.startsWith("[[package]]") && !/^source = /mu.test(block))
    .map((block) => /^name = "([^"]+)"$/mu.exec(block)[1])
    .sort();
  assert.deepEqual(local, workspace);
  assert.ok(!/^name = "palamedes[^"]*"\nversion = /mu.test(normalizeCargoLock(lock)));
});
