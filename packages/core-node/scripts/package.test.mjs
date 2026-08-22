import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"

const packageDir = path.resolve(import.meta.dirname, "..")

test("the packed wrapper pins every native optional dependency exactly", (context) => {
  const archiveDir = mkdtempSync(path.join(os.tmpdir(), "palamedes-core-node-pack-"))
  context.after(() => rmSync(archiveDir, { recursive: true, force: true }))

  const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
  execFileSync(packageManager, ["pack", "--pack-destination", archiveDir], {
    cwd: packageDir,
    env: { ...process.env, npm_config_cache: path.join(archiveDir, "npm-cache") },
    shell: process.platform === "win32",
    stdio: "pipe",
  })
  const archive = readdirSync(archiveDir).find((entry) => entry.endsWith(".tgz"))
  assert.ok(archive, "npm pack did not produce an archive")

  const manifest = JSON.parse(
    execFileSync("tar", ["-xOzf", path.join(archiveDir, archive), "package/package.json"], {
      encoding: "utf8",
    })
  )
  const platformPackages = Object.entries(manifest.optionalDependencies).filter(([name]) =>
    name.startsWith("@palamedes/core-node-")
  )
  assert.equal(platformPackages.length, 8)
  for (const [name, version] of platformPackages) {
    assert.equal(version, manifest.version, `${name} must be pinned in the packed manifest`)
  }

  assert.equal(
    readFileSync(path.join(packageDir, "package.json"), "utf8").includes("workspace:*"),
    true
  )
})
