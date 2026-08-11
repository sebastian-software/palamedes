import test from "node:test"
import assert from "node:assert/strict"

import { detectLinuxLibc } from "./build-native-lib.mjs"

test("detectLinuxLibc identifies glibc and musl without guessing", () => {
  assert.equal(
    detectLinuxLibc({ platform: "linux", report: { header: { glibcVersionRuntime: "2.39" } } }),
    "glibc"
  )
  assert.equal(
    detectLinuxLibc({ platform: "linux", report: { sharedObjects: ["/lib/ld-musl-x86_64.so.1"] } }),
    "musl"
  )
  assert.equal(
    detectLinuxLibc({
      platform: "linux",
      report: { sharedObjects: ["/lib/x86_64-linux-gnu/libc.so.6"] },
    }),
    "glibc"
  )
  assert.equal(detectLinuxLibc({ platform: "linux", report: {} }), null)
  assert.equal(detectLinuxLibc({ platform: "darwin" }), null)
})
