import { readFile } from "node:fs/promises"
import assert from "node:assert/strict"
import test from "node:test"

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))

test("uses hook-free component entries in React Server Components", () => {
  assert.deepEqual(packageJson.exports["."]["react-server"], {
    import: {
      types: "./dist/index-server.d.mts",
      default: "./dist/index-server.mjs",
    },
    require: {
      types: "./dist/index-server.d.cts",
      default: "./dist/index-server.cjs",
    },
  })
  assert.deepEqual(packageJson.exports["./compiled"]["react-server"], {
    import: {
      types: "./dist/compiled-server.d.mts",
      default: "./dist/compiled-server.mjs",
    },
    require: {
      types: "./dist/compiled-server.d.cts",
      default: "./dist/compiled-server.cjs",
    },
  })
})
