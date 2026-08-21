import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import test from "node:test"

const binary = fileURLToPath(new URL("../bin/palamedes.mjs", import.meta.url))
const quickstartUrl = "https://palamedes.dev/docs/first-working-translation"

test("bare palamedes invocation explains the supported path and fails", () => {
  const result = run()

  assert.equal(result.status, 1)
  assert.equal(result.stdout, "")
  assert.match(result.stderr, /currently a placeholder/u)
  assert.match(result.stderr, /@palamedes\/cli/u)
  assert.ok(result.stderr.includes(quickstartUrl))
})

test("palamedes rejects unsupported command arguments as usage", () => {
  const result = run("extract")

  assert.equal(result.status, 2)
  assert.equal(result.stdout, "")
  assert.match(result.stderr, /does not accept command arguments yet/u)
  assert.ok(result.stderr.includes(quickstartUrl))
})

function run(...arguments_) {
  return spawnSync(process.execPath, [binary, ...arguments_], { encoding: "utf8" })
}
