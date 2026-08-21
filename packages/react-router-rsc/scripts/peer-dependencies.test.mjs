import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))

const supportedPeers = {
  "@react-router/dev": {
    range: "~8.3.0",
    acceptedPatch: "8.3.1",
    rejectedMinor: "8.4.0",
  },
  "@vitejs/plugin-rsc": {
    range: "~0.5.34",
    acceptedPatch: "0.5.35",
    rejectedMinor: "0.6.0",
  },
  "react-router": {
    range: "~8.3.0",
    acceptedPatch: "8.3.1",
    rejectedMinor: "8.4.0",
  },
}

test("RSC peers allow only verified patch release lines", () => {
  for (const [name, { range, acceptedPatch, rejectedMinor }] of Object.entries(supportedPeers)) {
    assert.equal(manifest.peerDependencies[name], range)
    assert.equal(satisfiesTildeRange(acceptedPatch, range), true)
    assert.equal(satisfiesTildeRange(rejectedMinor, range), false)
  }
})

function satisfiesTildeRange(version, range) {
  const match = /^~(\d+)\.(\d+)\.(\d+)$/.exec(range)
  assert.ok(match, `Expected a patch-only tilde range, received ${range}`)

  const [major, minor, patch] = version.split(".").map(Number)
  const [, requiredMajor, requiredMinor, requiredPatch] = match.map(Number)

  return major === requiredMajor && minor === requiredMinor && patch >= requiredPatch
}
