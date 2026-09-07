import test from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildNativePackage, detectLinuxLibc, rustArtifactFileName } from "./build-native-lib.mjs";

test("native Cargo builds inherit the release endpoint but ordinary builds leave it absent", (t) => {
  const originalDirectory = process.cwd();
  const originalEndpoint = process.env.PALAMEDES_UPDATE_ENDPOINT;
  const fixture = mkdtempSync(join(tmpdir(), "palamedes-build-env-"));
  const calls = [];
  const cargo = t.mock.method(childProcess, "execFileSync", (...args) => calls.push(args));
  syncBuiltinESMExports();
  try {
    writeFileSync(
      join(fixture, "package.json"),
      JSON.stringify({ name: "@palamedes/cli-fixture" }),
    );
    process.chdir(fixture);
    const build = () =>
      buildNativePackage({
        targets: { "@palamedes/cli-fixture": { platform: process.platform, arch: process.arch } },
        cargoPackage: "palamedes-cli",
        unsupportedTargetMessage: (name) => name,
        postBuild() {},
      });
    process.env.PALAMEDES_UPDATE_ENDPOINT = "https://version-service.sebastian-software.de/check";
    build();
    delete process.env.PALAMEDES_UPDATE_ENDPOINT;
    build();
    assert.equal(calls.length, 2);
    assert.equal(calls[0][0], "cargo");
    assert.deepEqual(calls[0][1].slice(0, 3), ["build", "--package", "palamedes-cli"]);
    assert.equal(
      calls[0][2].env.PALAMEDES_UPDATE_ENDPOINT,
      "https://version-service.sebastian-software.de/check",
    );
    assert.equal(Object.hasOwn(calls[1][2].env, "PALAMEDES_UPDATE_ENDPOINT"), false);
  } finally {
    process.chdir(originalDirectory);
    if (originalEndpoint === undefined) delete process.env.PALAMEDES_UPDATE_ENDPOINT;
    else process.env.PALAMEDES_UPDATE_ENDPOINT = originalEndpoint;
    cargo.mock.restore();
    syncBuiltinESMExports();
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("detectLinuxLibc identifies glibc and musl without guessing", () => {
  assert.equal(
    detectLinuxLibc({ platform: "linux", report: { header: { glibcVersionRuntime: "2.39" } } }),
    "glibc",
  );
  assert.equal(
    detectLinuxLibc({ platform: "linux", report: { sharedObjects: ["/lib/ld-musl-x86_64.so.1"] } }),
    "musl",
  );
  assert.equal(
    detectLinuxLibc({
      platform: "linux",
      report: { sharedObjects: ["/lib/x86_64-linux-gnu/libc.so.6"] },
    }),
    "glibc",
  );
  assert.equal(detectLinuxLibc({ platform: "linux", report: {} }), null);
  assert.equal(detectLinuxLibc({ platform: "darwin" }), null);
});

test("rustArtifactFileName follows Cargo host naming on every published platform", () => {
  assert.equal(
    rustArtifactFileName({ name: "pmds", kind: "executable", platform: "linux" }),
    "pmds",
  );
  assert.equal(
    rustArtifactFileName({ name: "pmds", kind: "executable", platform: "darwin" }),
    "pmds",
  );
  assert.equal(
    rustArtifactFileName({ name: "pmds", kind: "executable", platform: "win32" }),
    "pmds.exe",
  );
  assert.equal(
    rustArtifactFileName({ name: "palamedes_node", kind: "cdylib", platform: "linux" }),
    "libpalamedes_node.so",
  );
  assert.equal(
    rustArtifactFileName({ name: "palamedes_node", kind: "cdylib", platform: "darwin" }),
    "libpalamedes_node.dylib",
  );
  assert.equal(
    rustArtifactFileName({ name: "palamedes_node", kind: "cdylib", platform: "win32" }),
    "palamedes_node.dll",
  );
  assert.throws(
    () => rustArtifactFileName({ name: "palamedes_node", kind: "cdylib", platform: "aix" }),
    /Unsupported platform for Rust artifact palamedes_node: aix/u,
  );
  assert.throws(
    () => rustArtifactFileName({ name: "palamedes_node", kind: "staticlib" }),
    /Unsupported Rust artifact kind for palamedes_node: staticlib/u,
  );
});
