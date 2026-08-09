import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"

const packageDir = path.resolve(import.meta.dirname, "..")
const repoRoot = path.resolve(packageDir, "../..")
const runtimeDir = path.join(repoRoot, "packages", "runtime")
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "palamedes-waku-packed-"))

try {
  const archiveDir = path.join(fixtureRoot, "archives")
  mkdirSync(archiveDir)
  const runtimeArchive = packPackage(runtimeDir, archiveDir)
  const wakuArchive = packPackage(packageDir, archiveDir)
  const consumerRoot = path.join(fixtureRoot, "consumer")
  mkdirSync(consumerRoot)
  writeFileSync(
    path.join(consumerRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "waku-packed-consumer",
        private: true,
        type: "module",
        dependencies: {
          "@palamedes/runtime": `file:${runtimeArchive}`,
          "@palamedes/waku": `file:${wakuArchive}`,
          waku: "1.0.0-beta.9",
        },
      },
      null,
      2
    )}\n`
  )
  writeFileSync(
    path.join(consumerRoot, "pnpm-workspace.yaml"),
    `overrides:\n  "@palamedes/runtime": "file:${runtimeArchive}"\n`
  )
  runPackageManager(consumerRoot, ["install", "--ignore-scripts"])

  const installedWaku = path.join(consumerRoot, "node_modules", "@palamedes", "waku")
  const manifest = JSON.parse(readFileSync(path.join(installedWaku, "package.json"), "utf8"))
  assert.deepEqual(manifest.exports["."], {
    types: "./dist/index.d.ts",
    import: "./dist/index.mjs",
  })
  assert.equal(Object.hasOwn(manifest, "main"), false)
  assert.equal(Object.hasOwn(manifest, "module"), false)
  assert.equal(existsSync(path.join(installedWaku, "dist", "index.cjs")), false)
  assert.equal(
    JSON.parse(
      readFileSync(path.join(consumerRoot, "node_modules", "waku", "package.json"), "utf8")
    ).version,
    "1.0.0-beta.9"
  )

  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      'const adapter = await import("@palamedes/waku"); if (typeof adapter.createWakuI18nInterceptor !== "function") process.exit(1)',
    ],
    { cwd: consumerRoot, stdio: "pipe" }
  )
  execFileSync(
    process.execPath,
    [
      "--eval",
      'try { require("@palamedes/waku"); process.exit(1) } catch (error) { if (error?.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED" || !String(error.message).includes("@palamedes/waku")) process.exit(1) }',
    ],
    { cwd: consumerRoot, stdio: "pipe" }
  )
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true })
}

function packPackage(directory, archiveDir) {
  const existingArchives = new Set(readdirSync(archiveDir))
  runPackageManager(directory, ["pack", "--pack-destination", archiveDir])
  const archives = readdirSync(archiveDir)
    .filter((entry) => entry.endsWith(".tgz") && !existingArchives.has(entry))
    .map((entry) => path.join(archiveDir, entry))
  assert.equal(archives.length, 1, `Expected one packed archive for ${directory}`)
  return archives[0]
}

function runPackageManager(cwd, args) {
  execFileSync(packageManager, args, {
    cwd,
    env: { ...process.env, CI: "true" },
    shell: process.platform === "win32",
    stdio: "pipe",
  })
}
