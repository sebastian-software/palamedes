import { readFile } from "node:fs/promises"
import assert from "node:assert/strict"
import test from "node:test"

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))

test("uses hook-free package entries in React Server Components", () => {
  assert.deepEqual(packageJson.exports["."]["react-server"], {
    types: "./dist/index-server.d.ts",
    import: "./dist/index-server.mjs",
    require: "./dist/index-server.cjs",
  })
  assert.deepEqual(packageJson.exports["./runtime"]["react-server"], {
    types: "./dist/runtime-server.d.ts",
    import: "./dist/runtime-server.mjs",
    require: "./dist/runtime-server.cjs",
  })
})
