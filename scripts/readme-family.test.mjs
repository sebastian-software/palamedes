import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { javascriptWorkspacePackages } from "./release-packages.mjs";
import { familyReadmeTargets, generatorSpecifier } from "./readme-family.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const targets = familyReadmeTargets(root);

test("covers every published non-platform package", () => {
  const expected = javascriptWorkspacePackages(root).map(
    ({ directory }) => `${directory}/README.md`,
  );
  assert.deepEqual(
    targets.map(({ file }) => file).sort(),
    expected.sort(),
    "run pnpm readme:family after adding or removing a published package",
  );
});

test("keeps npm READMEs separate from the native project README", () => {
  const variants = new Map(targets.map(({ file, variant }) => [file, variant]));
  assert.equal(variants.has("README.md"), false);
  for (const [file, variant] of variants) {
    if (file !== "README.md") assert.equal(variant, "registry", `${file} must render for npm`);
  }
});

test("leaves the platform packages out of the family block", () => {
  for (const { file } of targets) {
    assert.doesNotMatch(file, /(?:cli|core-node)-(?:darwin|linux|win32)/u);
  }
});

test("every README the generator writes to exists", () => {
  for (const { file } of targets) assert.ok(existsSync(join(root, file)), `${file} is missing`);
});

test("pins the generator to a commit, never to a branch", () => {
  assert.match(
    generatorSpecifier,
    /^github:sebastian-software\/ferramenta#[\da-f]{40}&path:\/packages\/family$/u,
  );
});

test("documents how to regenerate the block and bump the pin", () => {
  const contributing = readFileSync(join(root, "CONTRIBUTING.md"), "utf8");
  for (const command of ["pnpm readme:family", "pnpm readme:family:check"]) {
    assert.ok(contributing.includes(command), `CONTRIBUTING.md must mention ${command}`);
  }
});
