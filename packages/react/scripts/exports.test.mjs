import { readFile } from "node:fs/promises"
import assert from "node:assert/strict"
import test from "node:test"

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))

test("uses hook-free component entries in React Server Components", () => {
  assert.deepEqual(packageJson.exports["."]["react-server"], {
    types: "./dist/index-server.d.ts",
    import: "./dist/index-server.mjs",
    require: "./dist/index-server.cjs",
  })
  assert.deepEqual(packageJson.exports["./compiled"]["react-server"], {
    types: "./dist/compiled-server.d.ts",
    import: "./dist/compiled-server.mjs",
    require: "./dist/compiled-server.cjs",
  })
})
