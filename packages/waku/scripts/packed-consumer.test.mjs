import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { packWorkspaceDependencies } from "../../../scripts/pack-workspace-dependencies.mjs";

const packageDir = path.resolve(import.meta.dirname, "..");
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "palamedes-waku-packed-"));

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
        name: "waku-packed-consumer",
        private: true,
        type: "module",
        dependencies: {
          "@palamedes/waku": overrides["@palamedes/waku"],
          waku: "1.0.0-rc.0",
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(path.join(consumerRoot, "pnpm-workspace.yaml"), JSON.stringify({ overrides }));
  runPackageManager(consumerRoot, ["install", "--ignore-scripts"]);

  const installedWaku = path.join(consumerRoot, "node_modules", "@palamedes", "waku");
  const manifest = JSON.parse(readFileSync(path.join(installedWaku, "package.json"), "utf8"));
  assert.deepEqual(manifest.exports["."], {
    types: "./dist/index.d.ts",
    import: "./dist/index.mjs",
  });
  assert.equal(Object.hasOwn(manifest, "main"), false);
  assert.equal(Object.hasOwn(manifest, "module"), false);
  assert.equal(existsSync(path.join(installedWaku, "dist", "index.cjs")), false);
  assert.equal(
    JSON.parse(
      readFileSync(path.join(consumerRoot, "node_modules", "waku", "package.json"), "utf8"),
    ).version,
    "1.0.0-rc.0",
  );

  assert.deepEqual(manifest.exports["./server"], {
    types: "./dist/server.d.ts",
    import: "./dist/server.mjs",
  });
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      'const adapter = await import("@palamedes/waku/server"); if(typeof adapter.createWakuCatalogDeliveryMiddleware!=="function") process.exit(1)',
    ],
    { cwd: consumerRoot, stdio: "pipe" },
  );

  // Waku's router entry executes under its Vite React Server Components runtime,
  // rather than directly in Node. Verify that the published adapter preserves
  // that peer boundary; the Waku example smoke tests exercise it at runtime.
  assert.match(
    readFileSync(path.join(installedWaku, "dist", "index.mjs"), "utf8"),
    /from ['"]waku\/router\/server['"]/,
  );
  execFileSync(
    process.execPath,
    [
      "--eval",
      'try { require("@palamedes/waku"); process.exit(1) } catch (error) { if (error?.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED" || !String(error.message).includes("@palamedes/waku")) process.exit(1) }',
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
