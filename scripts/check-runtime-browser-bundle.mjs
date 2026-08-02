import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import { brotliCompressSync, gzipSync } from "node:zlib"

const assetsDirectory = new URL("../examples/vite-mdx/dist/assets/", import.meta.url)
const assetNames = (await readdir(assetsDirectory)).filter((name) => name.endsWith(".js"))

assert.notEqual(assetNames.length, 0, "Build the Vite MDX example before checking its bundle")

const parserSignatures = [
  "Expected a non-negative integer plural offset",
  "Expected identifier at index",
  "Unterminated apostrophe quote",
  "while parsing message pattern",
]

let rawBytes = 0
let gzipBytes = 0
let brotliBytes = 0

for (const assetName of assetNames) {
  const source = await readFile(new URL(assetName, assetsDirectory))
  const code = source.toString("utf8")

  for (const signature of parserSignatures) {
    assert.equal(
      code.includes(signature),
      false,
      `The browser bundle contains the ICU parser signature ${JSON.stringify(signature)}`
    )
  }

  rawBytes += source.byteLength
  gzipBytes += gzipSync(source).byteLength
  brotliBytes += brotliCompressSync(source).byteLength
}

console.log(
  `Parser-free browser JavaScript: ${format(rawBytes)} raw, ${format(gzipBytes)} gzip, ${format(brotliBytes)} brotli`
)

function format(bytes) {
  return `${(bytes / 1000).toFixed(2)} kB`
}
