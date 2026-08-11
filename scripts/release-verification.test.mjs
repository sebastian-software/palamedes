import { describe, expect, it } from "vitest"

import { NATIVE_TARBALL_MIN_UNPACKED_SIZE, nativeTarballFailure } from "./release-verification.mjs"

describe("release tarball verification", () => {
  const nativePackage = {
    name: "@palamedes/cli-linux-arm64-musl",
    nativeArtifact: "bin/pmds",
    version: "1.17.1",
  }

  it("rejects native tarballs too small to contain their expected binary", () => {
    expect(nativeTarballFailure(nativePackage, 1_961)).toContain("bin/pmds")
    expect(nativeTarballFailure(nativePackage, 1_961)).toContain(
      String(NATIVE_TARBALL_MIN_UNPACKED_SIZE)
    )
  })

  it("accepts substantial native tarballs and never applies the floor to JavaScript packages", () => {
    expect(nativeTarballFailure(nativePackage, NATIVE_TARBALL_MIN_UNPACKED_SIZE)).toBeNull()
    expect(
      nativeTarballFailure({ name: "@palamedes/core", nativeArtifact: null, version: "1.17.1" }, 42)
    ).toBeNull()
  })
})
