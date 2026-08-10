import assert from "node:assert/strict"
import path from "node:path"
import test from "node:test"

import { detectLinuxLibc, resolveNativeExecutable, resolvePlatformPackage } from "./platform.mjs"

test("runtime target selection covers every published CLI package", () => {
  const targets = [
    [{ platform: "darwin", arch: "arm64" }, "@palamedes/cli-darwin-arm64"],
    [{ platform: "linux", arch: "x64", libc: "glibc" }, "@palamedes/cli-linux-x64-gnu"],
    [{ platform: "linux", arch: "x64", libc: "musl" }, "@palamedes/cli-linux-x64-musl"],
    [{ platform: "linux", arch: "arm64", libc: "glibc" }, "@palamedes/cli-linux-arm64-gnu"],
    [{ platform: "linux", arch: "arm64", libc: "musl" }, "@palamedes/cli-linux-arm64-musl"],
    [{ platform: "win32", arch: "x64" }, "@palamedes/cli-win32-x64-msvc"],
  ]

  for (const [target, expectedPackage] of targets) {
    assert.equal(resolvePlatformPackage(target), expectedPackage)
  }
})

test("Linux libc selection uses the runtime report", () => {
  assert.equal(
    detectLinuxLibc({
      platform: "linux",
      report: { header: { glibcVersionRuntime: "2.39" } },
    }),
    "glibc"
  )
  assert.equal(
    detectLinuxLibc({
      platform: "linux",
      report: { sharedObjects: ["/lib/ld-musl-x86_64.so.1"] },
    }),
    "musl"
  )
})

test("the runtime launcher resolves the platform package binary directly", () => {
  const packageDir = path.join("fixture", "node_modules", "@palamedes", "cli-win32-x64-msvc")
  let resolvedSpecifier
  let checkedPath
  const result = resolveNativeExecutable({
    platform: "win32",
    arch: "x64",
    resolvePackageJson(specifier) {
      resolvedSpecifier = specifier
      return path.join(packageDir, "package.json")
    },
    existsSync(candidate) {
      checkedPath = candidate
      return true
    },
  })

  const expected = path.join(packageDir, "bin", "pmds.exe")
  assert.equal(resolvedSpecifier, "@palamedes/cli-win32-x64-msvc/package.json")
  assert.equal(checkedPath, expected)
  assert.equal(result, expected)
})

test("missing optional packages and binaries produce actionable errors", () => {
  assert.throws(
    () =>
      resolveNativeExecutable({
        platform: "darwin",
        arch: "arm64",
        resolvePackageJson() {
          throw new Error("not found")
        },
      }),
    /@palamedes\/cli-darwin-arm64 is not installed.*Install optional dependencies/u
  )

  assert.throws(
    () =>
      resolveNativeExecutable({
        platform: "linux",
        arch: "x64",
        libc: "musl",
        resolvePackageJson: () => "/fixture/package.json",
        existsSync: () => false,
      }),
    /@palamedes\/cli-linux-x64-musl is installed, but its binary is missing/u
  )
})

test("unsupported and undetectable runtime targets produce useful errors", () => {
  assert.throws(
    () => resolvePlatformPackage({ platform: "darwin", arch: "x64" }),
    /does not publish a native binary for darwin\/x64/u
  )
  assert.throws(
    () => resolvePlatformPackage({ platform: "linux", arch: "x64", report: {} }),
    /could not determine the Linux C library/u
  )
})
