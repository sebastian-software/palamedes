import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { brotliCompressSync, gzipSync } from "node:zlib";

const assetsDirectory = new URL("../examples/vite-mdx/dist/assets/", import.meta.url);
const assetNames = (await readdir(assetsDirectory)).filter((name) => name.endsWith(".js"));
const parserSentinel = "[palamedes:icu-parser]";

assert.notEqual(assetNames.length, 0, "Build the Vite MDX example before checking its bundle");

// Positive control is test-only source; no public runtime may contain the parser.
const parserSource = await readFile(
  new URL("../packages/core/src/messageFormat.ts", import.meta.url),
  "utf8",
);
assert.ok(parserSource.includes(parserSentinel), "Parser sentinel positive control is missing");
await import("./check-public-runtime.mjs");

let rawBytes = 0;
let gzipBytes = 0;
let brotliBytes = 0;

for (const assetName of assetNames) {
  const source = await readFile(new URL(assetName, assetsDirectory));
  const code = source.toString("utf8");

  assert.equal(
    code.includes(parserSentinel),
    false,
    `The browser bundle contains the ICU parser sentinel in ${assetName}`,
  );

  rawBytes += source.byteLength;
  gzipBytes += gzipSync(source).byteLength;
  brotliBytes += brotliCompressSync(source).byteLength;
}

console.log(
  `Parser-free browser JavaScript: ${format(rawBytes)} raw, ${format(gzipBytes)} gzip, ${format(brotliBytes)} brotli`,
);

function format(bytes) {
  return `${(bytes / 1000).toFixed(2)} kB`;
}
