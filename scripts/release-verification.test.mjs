import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  NATIVE_TARBALL_MIN_UNPACKED_SIZE,
  nativeTarballFailure,
  verifyPublishedVersions,
} from "./release-verification.mjs";

describe("release tarball verification", () => {
  const publishedVersionCheck = readFileSync(
    new URL("check-published-versions.mjs", import.meta.url),
    "utf8",
  );
  const nativePackage = {
    name: "@palamedes/cli-linux-arm64-musl",
    nativeArtifact: "bin/pmds",
    version: "1.17.1",
  };

  it("rejects native tarballs too small to contain their expected binary", () => {
    expect(nativeTarballFailure(nativePackage, 1961)).toContain("bin/pmds");
    expect(nativeTarballFailure(nativePackage, 1961)).toContain(
      String(NATIVE_TARBALL_MIN_UNPACKED_SIZE),
    );
  });

  it("accepts substantial native tarballs and never applies the floor to JavaScript packages", () => {
    expect(nativeTarballFailure(nativePackage, NATIVE_TARBALL_MIN_UNPACKED_SIZE)).toBeNull();
    expect(
      nativeTarballFailure(
        { name: "@palamedes/core", nativeArtifact: null, version: "1.17.1" },
        42,
      ),
    ).toBeNull();
  });

  it("keeps native tarball size verification wired into the registry check", async () => {
    expect(publishedVersionCheck).toContain("verifyPublishedVersions({");

    const result = await verifyPublishedVersions({
      packages: [nativePackage],
      registryLookup(_spec, field) {
        return field === "dist.unpackedSize"
          ? { state: "found", value: "1961" }
          : { state: "found", value: nativePackage.version };
      },
      retryBudgetMs: 0,
      retryDelayMs: 15_000,
      log() {},
    });

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].detail).toContain("bin/pmds");
  });

  it("rechecks only missing packages until delayed visibility resolves", async () => {
    const delayedPackage = { name: "@palamedes/delayed", nativeArtifact: null, version: "1.0.0" };
    const visiblePackage = { name: "@palamedes/visible", nativeArtifact: null, version: "1.0.0" };
    const lookups = [];
    const waits = [];
    let delayedAttempts = 0;
    let time = 0;

    const result = await verifyPublishedVersions({
      packages: [delayedPackage, visiblePackage],
      registryLookup(spec) {
        lookups.push(spec);
        if (spec === "@palamedes/delayed@1.0.0" && delayedAttempts++ === 0) {
          return { state: "missing" };
        }
        return { state: "found", value: "1.0.0" };
      },
      retryBudgetMs: 60_000,
      retryDelayMs: 15_000,
      now() {
        return time;
      },
      async wait(milliseconds) {
        waits.push(milliseconds);
        time += milliseconds;
      },
      log() {},
    });

    expect(result).toEqual({ failures: [], missing: [] });
    expect(lookups).toEqual([
      "@palamedes/delayed@1.0.0",
      "@palamedes/visible@1.0.0",
      "@palamedes/delayed@1.0.0",
    ]);
    expect(waits).toEqual([15_000]);
  });

  it("keeps real registry errors fatal and gives missing packages a bounded retry window", async () => {
    const packageInfo = { name: "@palamedes/missing", nativeArtifact: null, version: "1.0.0" };
    const waits = [];
    let time = 0;

    const missingResult = await verifyPublishedVersions({
      packages: [packageInfo],
      registryLookup() {
        return { state: "missing" };
      },
      retryBudgetMs: 30_000,
      retryDelayMs: 15_000,
      now() {
        return time;
      },
      async wait(milliseconds) {
        waits.push(milliseconds);
        time += milliseconds;
      },
      log() {},
    });

    const errorResult = await verifyPublishedVersions({
      packages: [packageInfo],
      registryLookup() {
        return { detail: "npm unavailable", state: "error" };
      },
      retryBudgetMs: 30_000,
      retryDelayMs: 15_000,
      log() {},
    });

    expect(missingResult).toEqual({ failures: [], missing: ["@palamedes/missing@1.0.0"] });
    expect(waits).toEqual([15_000, 15_000]);
    expect(errorResult).toEqual({
      failures: [{ detail: "npm unavailable", spec: "@palamedes/missing@1.0.0" }],
      missing: [],
    });
  });
});
