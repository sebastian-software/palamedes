import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import test from "node:test"

const binary = fileURLToPath(new URL("../bin/create-palamedes.mjs", import.meta.url))
const quickstartUrl = "https://palamedes.dev/docs/first-working-translation"

test("bare create-palamedes invocation explains the supported path and fails", () => {
  const result = run()

  assert.equal(result.status, 1)
  assert.equal(result.stdout, "")
  assert.match(result.stderr, /reserved for future scaffolding/u)
  assert.ok(result.stderr.includes(quickstartUrl))
})

test("create-palamedes rejects unsupported project arguments as usage", () => {
  const result = run("my-app")

  assert.equal(result.status, 2)
  assert.equal(result.stdout, "")
  assert.match(result.stderr, /does not accept project arguments yet/u)
  assert.ok(result.stderr.includes(quickstartUrl))
})

function run(...arguments_) {
  return spawnSync(process.execPath, [binary, ...arguments_], { encoding: "utf8" })
}
