import test from "node:test"
import assert from "node:assert/strict"

import { detectLinuxLibc, rustArtifactFileName } from "./build-native-lib.mjs"

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

test("rustArtifactFileName follows Cargo host naming on every published platform", () => {
  assert.equal(
    rustArtifactFileName({ name: "pmds", kind: "executable", platform: "linux" }),
    "pmds"
  )
  assert.equal(
    rustArtifactFileName({ name: "pmds", kind: "executable", platform: "darwin" }),
    "pmds"
  )
  assert.equal(
    rustArtifactFileName({ name: "pmds", kind: "executable", platform: "win32" }),
    "pmds.exe"
  )
  assert.equal(
    rustArtifactFileName({ name: "palamedes_node", kind: "cdylib", platform: "linux" }),
    "libpalamedes_node.so"
  )
  assert.equal(
    rustArtifactFileName({ name: "palamedes_node", kind: "cdylib", platform: "darwin" }),
    "libpalamedes_node.dylib"
  )
  assert.equal(
    rustArtifactFileName({ name: "palamedes_node", kind: "cdylib", platform: "win32" }),
    "palamedes_node.dll"
  )
  assert.throws(
    () => rustArtifactFileName({ name: "palamedes_node", kind: "cdylib", platform: "aix" }),
    /Unsupported platform for Rust artifact palamedes_node: aix/u
  )
  assert.throws(
    () => rustArtifactFileName({ name: "palamedes_node", kind: "staticlib" }),
    /Unsupported Rust artifact kind for palamedes_node: staticlib/u
  )
})
