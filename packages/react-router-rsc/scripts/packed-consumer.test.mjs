import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { packWorkspaceDependencies } from "../../../scripts/pack-workspace-dependencies.mjs";

const packageDir = path.resolve(import.meta.dirname, "..");
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "palamedes-react-router-rsc-packed-"));

try {
  const archiveDir = path.join(fixtureRoot, "archives");
  mkdirSync(archiveDir);
  const overrides = packWorkspaceDependencies(packageDir, archiveDir);
  const consumerRoot = path.join(fixtureRoot, "consumer");
  mkdirSync(consumerRoot);
  writeFileSync(
    path.join(consumerRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "react-router-rsc-packed-consumer",
        private: true,
        type: "module",
        dependencies: { "@palamedes/react-router-rsc": overrides["@palamedes/react-router-rsc"] },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(path.join(consumerRoot, "pnpm-workspace.yaml"), JSON.stringify({ overrides }));
  runPackageManager(consumerRoot, ["install", "--ignore-scripts"]);

  const installedPackage = path.join(
    consumerRoot,
    "node_modules",
    "@palamedes",
    "react-router-rsc",
  );
  const manifest = JSON.parse(readFileSync(path.join(installedPackage, "package.json"), "utf8"));
  assert.deepEqual(manifest.exports["."], {
    types: "./dist/index.d.ts",
    import: "./dist/index.mjs",
  });
  assert.deepEqual(manifest.exports["./client"], {
    types: "./dist/client.d.ts",
    import: "./dist/client.mjs",
  });
  assert.deepEqual(manifest.sideEffects, ["./dist/client.mjs"]);
  assert.equal(Object.hasOwn(manifest, "main"), false);
  assert.equal(Object.hasOwn(manifest, "module"), false);
  assert.equal(existsSync(path.join(installedPackage, "dist", "index.cjs")), false);

  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      'const adapter = await import("@palamedes/react-router-rsc"); if (typeof adapter.createReactRouterRscI18nRequestScope !== "function") process.exit(1)',
    ],
    { cwd: consumerRoot, stdio: "pipe" },
  );
  execFileSync(
    process.execPath,
    [
      "--eval",
      'try { require("@palamedes/react-router-rsc"); process.exit(1) } catch (error) { if (error?.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED" || !String(error.message).includes("@palamedes/react-router-rsc")) process.exit(1) }',
    ],
    { cwd: consumerRoot, stdio: "pipe" },
  );
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

function runPackageManager(cwd, args) {
  execFileSync(packageManager, args, {
    cwd,
    env: { ...process.env, CI: "true" },
    shell: process.platform === "win32",
    stdio: "pipe",
  });
}
