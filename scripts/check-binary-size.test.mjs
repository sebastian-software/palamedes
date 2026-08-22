import assert from "node:assert/strict"
import path from "node:path"
import test from "node:test"

import {
  BUDGETS,
  checkBinarySizes,
  evaluateBinarySize,
  formatBinarySizeResult,
  releaseArtifactPath,
} from "./check-binary-size.mjs"

test("budgets both shipped Rust artifact families", () => {
  assert.deepEqual(
    BUDGETS.map(({ crate, artifact }) => [crate, artifact.kind]),
    [
      ["palamedes-cli", "executable"],
      ["palamedes-node", "cdylib"],
    ]
  )
  assert.equal(releaseArtifactPath(BUDGETS[0], "win32"), path.join("target", "release", "pmds.exe"))
  assert.equal(
    releaseArtifactPath(BUDGETS[1], "linux"),
    path.join("target", "release", "libpalamedes_node.so")
  )
  assert.equal(
    releaseArtifactPath(BUDGETS[1], "darwin"),
    path.join("target", "release", "libpalamedes_node.dylib")
  )
  assert.equal(
    releaseArtifactPath(BUDGETS[1], "win32"),
    path.join("target", "release", "palamedes_node.dll")
  )
})

test("reports the baseline, headroom, and exact artifact on success", () => {
  const budget = BUDGETS[1]
  const result = evaluateBinarySize(budget, budget.baseline.bytes + 100_000)
  const message = formatBinarySizeResult(result, "target/release/libpalamedes_node.so")

  assert.equal(result.headroom, 642_824)
  assert.match(message, /0\.10 MB \(100,000 B\) above that baseline/u)
  assert.match(message, /0\.64 MB \(642,824 B\) to spare/u)
})

test("fails every over-budget artifact with actionable diagnostics", () => {
  const errors = []
  const logs = []
  const sizes = new Map([
    ["pmds", BUDGETS[0].maxBytes + 1],
    ["libpalamedes_node.so", BUDGETS[1].maxBytes + 100_000],
  ])

  const exitCode = checkBinarySizes({
    platform: "linux",
    execute() {},
    stat(binaryPath) {
      return { size: sizes.get(path.basename(binaryPath)) }
    },
    output: {
      error(message) {
        errors.push(message)
      },
      log(message) {
        logs.push(message)
      },
    },
  })

  assert.equal(exitCode, 1)
  assert.equal(logs.length, 0)
  assert.equal(errors.length, 2)
  assert.match(errors[1], /exceeds the budget .* by 0\.10 MB \(100,000 B\)/u)
  assert.match(errors[1], /Baseline @palamedes\/core-node-linux-x64-gnu@1\.17\.3/u)
  assert.ok(
    errors[1].includes(`Artifact: ${path.join("target", "release", "libpalamedes_node.so")}`)
  )
  assert.match(errors[1], /Either shrink it, or raise maxBytes/u)
})

test("keeps checking after a built artifact is unexpectedly missing", () => {
  const errors = []
  const logs = []
  let statCalls = 0

  const exitCode = checkBinarySizes({
    platform: "darwin",
    execute() {},
    stat() {
      statCalls += 1
      if (statCalls === 1) {
        throw new Error("ENOENT")
      }
      return { size: BUDGETS[1].baseline.bytes }
    },
    output: {
      error(message) {
        errors.push(message)
      },
      log(message) {
        logs.push(message)
      },
    },
  })

  assert.equal(exitCode, 1)
  assert.equal(errors.length, 1)
  assert.ok(
    errors[0].includes(
      `expected executable was not found at ${path.join("target", "release", "pmds")}`
    )
  )
  assert.equal(logs.length, 1)
  assert.match(logs[0], /core-node addon \(release\)/u)
})
