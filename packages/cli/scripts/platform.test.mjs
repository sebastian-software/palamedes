import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"

import {
  assertNativeExecutableVersion,
  detectLinuxLibc,
  resolveNativeExecutable,
  resolvePlatformPackage,
} from "./platform.mjs"

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8")

function readmeTargetForPackage(packageName) {
  const target = packageName.replace("@palamedes/cli-", "")
  const targetNames = {
    "darwin-arm64": "macOS arm64",
    "linux-x64-gnu": "Linux x64 glibc",
    "linux-x64-musl": "Linux x64 musl",
    "linux-arm64-gnu": "Linux arm64 glibc",
    "linux-arm64-musl": "Linux arm64 musl",
    "win32-x64-msvc": "Windows x64 MSVC",
  }
  const readmeTarget = targetNames[target]
  assert.ok(readmeTarget, `add a README target name for ${packageName}`)
  return readmeTarget
}

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

  assert.deepEqual(
    new Set(targets.map(([, packageName]) => packageName)),
    new Set(Object.keys(packageJson.optionalDependencies))
  )
})

test("the README lists every published CLI platform package", () => {
  const match = readme.match(
    /The npm package currently publishes native binaries for:\n\n((?:- .+\n)+)/u
  )
  assert.ok(match, "README must include a native platform list")

  const documentedTargets = match[1]
    .trim()
    .split("\n")
    .map((line) => line.replace(/^- /u, ""))
  const publishedTargets = Object.keys(packageJson.optionalDependencies).map(readmeTargetForPackage)

  assert.equal(documentedTargets.length, publishedTargets.length)
  assert.deepEqual(new Set(documentedTargets), new Set(publishedTargets))
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
  const wrapperPackageJsonPath = path.join(
    "fixture",
    "node_modules",
    "@palamedes",
    "cli",
    "package.json"
  )
  let resolvedSpecifier
  let checkedPath
  const result = resolveNativeExecutable({
    platform: "win32",
    arch: "x64",
    resolvePackageJson(specifier) {
      resolvedSpecifier = specifier
      return path.join(packageDir, "package.json")
    },
    wrapperPackageJsonPath,
    readFileSync(candidate) {
      assert.ok(
        candidate === wrapperPackageJsonPath || candidate === path.join(packageDir, "package.json")
      )
      return JSON.stringify({ version: "1.17.3" })
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

test("the runtime launcher rejects stale platform packages before starting their binary", () => {
  const packageDir = path.join("fixture", "node_modules", "@palamedes", "cli-linux-x64-gnu")
  const wrapperPackageJsonPath = path.join(
    "fixture",
    "node_modules",
    "@palamedes",
    "cli",
    "package.json"
  )
  let binaryChecked = false

  assert.throws(
    () =>
      resolveNativeExecutable({
        platform: "linux",
        arch: "x64",
        libc: "glibc",
        resolvePackageJson: () => path.join(packageDir, "package.json"),
        wrapperPackageJsonPath,
        readFileSync(candidate) {
          return JSON.stringify({
            version: candidate === wrapperPackageJsonPath ? "1.17.3" : "1.17.2",
          })
        },
        existsSync() {
          binaryChecked = true
          return true
        },
      }),
    /@palamedes\/cli@1\.17\.3 resolved @palamedes\/cli-linux-x64-gnu@1\.17\.2.*Reinstall @palamedes\/cli/u
  )
  assert.equal(binaryChecked, false)
})

test("native executable version validation accepts exact optional dependencies", () => {
  assert.doesNotThrow(() =>
    assertNativeExecutableVersion("1.17.3", "@palamedes/cli-linux-x64-gnu", "1.17.3")
  )
})

test("the runtime launcher reports invalid wrapper and native package metadata", () => {
  const packageDir = path.join("fixture", "node_modules", "@palamedes", "cli-linux-x64-musl")
  const wrapperPackageJsonPath = path.join(
    "fixture",
    "node_modules",
    "@palamedes",
    "cli",
    "package.json"
  )
  const options = {
    platform: "linux",
    arch: "x64",
    libc: "musl",
    resolvePackageJson: () => path.join(packageDir, "package.json"),
    wrapperPackageJsonPath,
    existsSync: () => true,
  }

  assert.throws(
    () => resolveNativeExecutable({ ...options, readFileSync: () => "not json" }),
    /could not read its own package metadata.*Reinstall @palamedes\/cli/u
  )
  assert.throws(
    () => resolveNativeExecutable({ ...options, readFileSync: () => JSON.stringify({}) }),
    /could not read its own version.*Reinstall @palamedes\/cli/u
  )
  assert.throws(
    () =>
      resolveNativeExecutable({
        ...options,
        readFileSync(candidate) {
          return candidate === wrapperPackageJsonPath
            ? JSON.stringify({ version: "1.17.3" })
            : JSON.stringify({})
        },
      }),
    /@palamedes\/cli-linux-x64-musl has no valid version.*install matching/u
  )
  assert.throws(
    () =>
      resolveNativeExecutable({
        ...options,
        readFileSync(candidate) {
          return candidate === wrapperPackageJsonPath
            ? JSON.stringify({ version: "1.17.3" })
            : "not json"
        },
      }),
    /@palamedes\/cli-linux-x64-musl has invalid package metadata.*install matching/u
  )
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
        wrapperPackageJsonPath: "/fixture/cli/package.json",
        readFileSync(candidate) {
          return JSON.stringify({
            version: candidate === "/fixture/cli/package.json" ? "1.17.3" : "1.17.3",
          })
        },
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
