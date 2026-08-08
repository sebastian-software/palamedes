import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import process from "node:process"
import test from "node:test"

const packageDir = path.resolve(import.meta.dirname, "..")
const repositoryRoot = path.resolve(packageDir, "..", "..")

function linkPackage(consumerRoot, scope, name, target) {
  const scopeDirectory = path.join(consumerRoot, "node_modules", scope)
  mkdirSync(scopeDirectory, { recursive: true })
  symlinkSync(
    target,
    path.join(scopeDirectory, name),
    process.platform === "win32" ? "junction" : "dir"
  )
}

test("the packed package exposes a loadable ESM entry and no CommonJS entry", (context) => {
  const archiveDir = mkdtempSync(path.join(os.tmpdir(), "palamedes-tanstack-pack-"))
  const consumerRoot = mkdtempSync(path.join(os.tmpdir(), "palamedes-tanstack-consumer-"))
  context.after(() => {
    rmSync(archiveDir, { recursive: true, force: true })
    rmSync(consumerRoot, { recursive: true, force: true })
  })

  const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
  execFileSync(packageManager, ["pack", "--pack-destination", archiveDir], {
    cwd: packageDir,
    env: { ...process.env, npm_config_cache: path.join(archiveDir, "npm-cache") },
    shell: process.platform === "win32",
    stdio: "pipe",
  })
  const archive = readdirSync(archiveDir).find((entry) => entry.endsWith(".tgz"))
  assert.ok(archive, "pnpm pack did not produce an archive")

  execFileSync("tar", ["-xzf", path.join(archiveDir, archive), "-C", consumerRoot], {
    stdio: "pipe",
  })
  const packageScopeDirectory = path.join(consumerRoot, "node_modules", "@palamedes")
  mkdirSync(packageScopeDirectory, { recursive: true })
  const packedPackage = path.join(packageScopeDirectory, "tanstack")
  renameSync(path.join(consumerRoot, "package"), packedPackage)

  const packedManifest = JSON.parse(readFileSync(path.join(packedPackage, "package.json"), "utf8"))
  assert.deepEqual(packedManifest.exports["."], {
    types: "./dist/index.d.ts",
    import: "./dist/index.mjs",
  })
  assert.equal(packedManifest.main, undefined)
  assert.equal(packedManifest.module, undefined)
  assert.equal(
    readdirSync(path.join(packedPackage, "dist")).some((entry) => entry.endsWith(".cjs")),
    false
  )

  linkPackage(
    consumerRoot,
    "@palamedes",
    "runtime",
    path.join(repositoryRoot, "packages", "runtime")
  )
  linkPackage(
    consumerRoot,
    "@tanstack",
    "react-start",
    path.join(packageDir, "node_modules", "@tanstack", "react-start")
  )

  const esmConsumer = path.join(consumerRoot, "consumer.mjs")
  writeFileSync(
    esmConsumer,
    `import {
  createTanStackI18nMiddleware,
  createTanStackI18nRequestMiddleware,
} from "@palamedes/tanstack"

if (typeof createTanStackI18nMiddleware !== "function") {
  throw new Error("The ESM middleware export did not load")
}
if (typeof createTanStackI18nRequestMiddleware !== "function") {
  throw new Error("The ESM request middleware export did not load")
}
`
  )
  execFileSync(process.execPath, [esmConsumer], { cwd: consumerRoot, stdio: "pipe" })

  const commonJsConsumer = path.join(consumerRoot, "consumer.cjs")
  writeFileSync(
    commonJsConsumer,
    `try {
  require("@palamedes/tanstack")
  throw new Error("CommonJS must not load the ESM-only package")
} catch (error) {
  if (error?.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") {
    throw error
  }
}
`
  )
  const commonJsResult = spawnSync(process.execPath, [commonJsConsumer], {
    cwd: consumerRoot,
    encoding: "utf8",
  })
  assert.equal(commonJsResult.status, 0, commonJsResult.stderr)
})
