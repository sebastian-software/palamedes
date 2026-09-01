import assert from "node:assert/strict"
import test from "node:test"
import { assertDualExportsUseFormatSpecificTargets } from "./published-export-contracts.mjs"

function packageWithDualExport() {
  return {
    manifest: {
      name: "@palamedes/example",
      exports: {
        ".": {
          import: {
            types: "./dist/index.d.mts",
            default: "./dist/index.mjs",
          },
          require: {
            types: "./dist/index.d.cts",
            default: "./dist/index.cjs",
          },
        },
      },
    },
  }
}

test("accepts format-specific declaration and runtime targets", () => {
  assert.doesNotThrow(() => assertDualExportsUseFormatSpecificTargets([packageWithDualExport()]))
})

test("rejects an ESM runtime target routed through require", () => {
  const packageEntry = packageWithDualExport()
  packageEntry.manifest.exports["."].require.default = "./dist/index.mjs"

  assert.throws(
    () => assertDualExportsUseFormatSpecificTargets([packageEntry]),
    /\.require\.default must reference a \.cjs runtime target\./
  )
})

test("rejects a CommonJS runtime target routed through import", () => {
  const packageEntry = packageWithDualExport()
  packageEntry.manifest.exports["."].import.default = "./dist/index.cjs"

  assert.throws(
    () => assertDualExportsUseFormatSpecificTargets([packageEntry]),
    /\.import\.default must reference a \.mjs runtime target\./
  )
})
