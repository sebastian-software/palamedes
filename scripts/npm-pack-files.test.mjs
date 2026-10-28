import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { packedFilePathsFromJson } from "./npm-pack-files.mjs";

const packageName = "@palamedes/pack-fixture";
const entry = {
  name: packageName,
  version: "1.0.0",
  files: [{ path: "dist/index.d.mts" }, { path: "package.json" }],
};

test("reads the same declaration paths from npm 11 and npm 12 pack output", () => {
  for (const output of [[entry], { [packageName]: entry }]) {
    const files = packedFilePathsFromJson(JSON.stringify(output), packageName);
    assert.deepEqual(files, new Set(["dist/index.d.mts", "package.json"]));
    assert.equal(files.has("dist/excluded.d.mts"), false);
  }
});

test("rejects missing, multiple, mismatched, or malformed package entries", () => {
  for (const output of [
    null,
    [],
    {},
    [entry, entry],
    { [packageName]: entry, other: entry },
    { other: entry },
    [{ ...entry, name: "other" }],
    { [packageName]: { ...entry, name: "other" } },
    [{ name: packageName }],
    [{ ...entry, files: {} }],
  ]) {
    assert.throws(
      () => packedFilePathsFromJson(JSON.stringify(output), packageName),
      /npm pack must return exactly one package named @palamedes\/pack-fixture with a files array\./u,
    );
  }
  assert.throws(
    () => packedFilePathsFromJson("not JSON", packageName),
    /npm pack returned invalid JSON for @palamedes\/pack-fixture\./u,
  );
});

test("rejects malformed or non-relative packed file paths", () => {
  for (const file of [
    null,
    {},
    { path: 1 },
    ...[
      "",
      "/index.d.ts",
      "../index.d.ts",
      "dist/../index.d.ts",
      "./index.d.ts",
      "C:\\index.d.ts",
      "dist\\index.d.ts",
    ].map((filePath) => ({ path: filePath })),
  ]) {
    assert.throws(
      () => packedFilePathsFromJson(JSON.stringify([{ ...entry, files: [file] }]), packageName),
      /npm pack returned an invalid file path for @palamedes\/pack-fixture\./u,
    );
  }
});

test("reads the installed npm's real pack output and keeps excluded declarations absent", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "palamedes-npm-pack-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const packageDirectory = path.join(root, "package");
  mkdirSync(path.join(packageDirectory, "dist"), { recursive: true });
  writeFileSync(
    path.join(packageDirectory, "package.json"),
    JSON.stringify({ name: packageName, version: "1.0.0", files: ["dist/index.d.mts"] }),
  );
  writeFileSync(
    path.join(packageDirectory, "dist/index.d.mts"),
    "export declare const value: string;\n",
  );
  writeFileSync(
    path.join(packageDirectory, "dist/excluded.d.mts"),
    "export declare const excluded: string;\n",
  );

  const result = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    {
      cwd: packageDirectory,
      encoding: "utf8",
      env: { ...process.env, npm_config_cache: path.join(root, "npm-cache") },
      shell: process.platform === "win32",
    },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    packedFilePathsFromJson(result.stdout, packageName),
    new Set(["dist/index.d.mts", "package.json"]),
  );
});
