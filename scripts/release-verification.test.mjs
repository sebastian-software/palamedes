import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  NATIVE_TARBALL_MIN_UNPACKED_SIZE,
  nativeTarballFailure,
  REGISTRY_VERIFICATION_TIMEOUT_MS,
  waitForRegistryEntries,
} from "./release-verification.mjs"

describe("release tarball verification", () => {
  const publishedVersionCheck = readFileSync(
    new URL("check-published-versions.mjs", import.meta.url),
    "utf8"
  )
  const nativePackage = {
    name: "@palamedes/cli-linux-arm64-musl",
    nativeArtifact: "bin/pmds",
    version: "1.17.1",
  }

  it("rejects native tarballs too small to contain their expected binary", () => {
    expect(nativeTarballFailure(nativePackage, 1961)).toContain("bin/pmds")
    expect(nativeTarballFailure(nativePackage, 1961)).toContain(
      String(NATIVE_TARBALL_MIN_UNPACKED_SIZE)
    )
  })

  it("accepts substantial native tarballs and never applies the floor to JavaScript packages", () => {
    expect(nativeTarballFailure(nativePackage, NATIVE_TARBALL_MIN_UNPACKED_SIZE)).toBeNull()
    expect(
      nativeTarballFailure({ name: "@palamedes/core", nativeArtifact: null, version: "1.17.1" }, 42)
    ).toBeNull()
  })

  it("keeps native tarball size verification wired into the registry check", () => {
    expect(publishedVersionCheck).toContain("const nativeTarballs = await waitForRegistryEntries")
    expect(publishedVersionCheck).toContain('registryLookup(spec, "dist.unpackedSize")')
    expect(publishedVersionCheck).toContain("nativeTarballFailure(packageInfo, lookup.value)")
    expect(publishedVersionCheck).toContain("failures.push({ detail: tarballFailure, spec })")
  })

  it("retries only unresolved entries in shared rounds until they become visible", async () => {
    let clock = 0
    const calls = new Map()
    const sleeps = []

    const result = await waitForRegistryEntries([{ spec: "fast" }, { spec: "delayed" }], {
      lookup({ spec }) {
        const attempt = (calls.get(spec) ?? 0) + 1
        calls.set(spec, attempt)
        return attempt >= (spec === "fast" ? 1 : 3)
          ? { state: "found", value: spec }
          : { state: "missing" }
      },
      now: () => clock,
      retryDelayMs: 20,
      async sleep(milliseconds) {
        sleeps.push(milliseconds)
        clock += milliseconds
      },
      timeoutMs: 100,
    })

    expect(result.found.map(({ spec }) => spec)).toEqual(["fast", "delayed"])
    expect(result.unresolved).toEqual([])
    expect(Object.fromEntries(calls)).toEqual({ fast: 1, delayed: 3 })
    expect(sleeps).toEqual([20, 20])
  })

  it("uses a five-minute default deadline and performs one final lookup at the deadline", async () => {
    let clock = 0
    let calls = 0
    const sleeps = []

    const result = await waitForRegistryEntries([{ spec: "still-missing" }], {
      lookup() {
        calls += 1
        return { state: "missing", detail: "not visible" }
      },
      now: () => clock,
      retryDelayMs: 20,
      async sleep(milliseconds) {
        sleeps.push(milliseconds)
        clock += milliseconds
      },
      timeoutMs: 50,
    })

    expect(REGISTRY_VERIFICATION_TIMEOUT_MS).toBe(300_000)
    expect(calls).toBe(4)
    expect(sleeps).toEqual([20, 20, 10])
    expect(result.unresolved).toEqual([
      { spec: "still-missing", lookup: { state: "missing", detail: "not visible" } },
    ])
  })
})
