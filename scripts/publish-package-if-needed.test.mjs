import { spawnSync } from "node:child_process"
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import assert from "node:assert/strict"
import test from "node:test"

const script = path.resolve(import.meta.dirname, "publish-package-if-needed.mjs")

test("publishes JavaScript workspace dependencies before their dependents", (t) => {
  const fixture = publishFixture(t)
  fixture.package("dependent", "@example/dependent", { "@example/runtime": "workspace:^" })
  fixture.package("runtime", "@example/runtime")
  fixture.package("independent", "@example/independent")

  const result = fixture.publish()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(fixture.published(), [
    "./packages/independent",
    "./packages/runtime",
    "./packages/dependent",
  ])
})

test("stops JavaScript publishing at the first failed package", (t) => {
  const fixture = publishFixture(t)
  fixture.package("dependent", "@example/dependent", { "@example/runtime": "workspace:^" })
  fixture.package("runtime", "@example/runtime")
  fixture.package("independent", "@example/independent")

  const result = fixture.publish({ failFilter: "./packages/runtime" })

  assert.equal(result.status, 1)
  assert.match(result.stderr, /failed at @example\/runtime; aborting/u)
  assert.deepEqual(fixture.published(), ["./packages/independent", "./packages/runtime"])
})

function publishFixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "palamedes-publish-packages-"))
  const binDirectory = path.join(root, "bin")
  const logPath = path.join(root, "publish.log")
  mkdirSync(path.join(root, "packages"), { recursive: true })
  mkdirSync(binDirectory)
  writeFileSync(
    path.join(binDirectory, "pnpm"),
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs"

const args = process.argv.slice(2)
if (args[0] === "view") {
  process.stderr.write("404 Not Found\\n")
  process.exit(1)
}
if (args[0] === "--filter" && args[2] === "publish") {
  appendFileSync(process.env.PUBLISH_LOG, args[1] + "\\n")
  process.exit(args[1] === process.env.FAIL_FILTER ? 1 : 0)
}
process.exit(1)
`
  )
  chmodSync(path.join(binDirectory, "pnpm"), 0o755)
  t.after(() => rmSync(root, { recursive: true, force: true }))

  return {
    package(directory, name, dependencies = {}) {
      const packageDirectory = path.join(root, "packages", directory)
      mkdirSync(packageDirectory)
      writeFileSync(
        path.join(packageDirectory, "package.json"),
        JSON.stringify({ name, version: "1.0.0", dependencies })
      )
    },
    publish({ failFilter } = {}) {
      return spawnSync(process.execPath, [script, "--all-js"], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          FAIL_FILTER: failFilter,
          PATH: `${binDirectory}${path.delimiter}${process.env.PATH}`,
          PUBLISH_LOG: logPath,
        },
      })
    },
    published() {
      try {
        return readFileSync(logPath, "utf8").trim().split("\n")
      } catch (error) {
        if (error.code === "ENOENT") {
          return []
        }
        throw error
      }
    },
  }
}
