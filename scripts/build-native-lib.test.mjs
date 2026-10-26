import test from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, basename as pathBasename } from "node:path";

import { buildNativePackage, detectLinuxLibc, rustArtifactFileName } from "./build-native-lib.mjs";

test("native Cargo builds inherit the release endpoint but ordinary builds leave it absent", (t) => {
  const originalDirectory = process.cwd();
  const originalEndpoint = process.env.PALAMEDES_UPDATE_ENDPOINT;
  const fixture = mkdtempSync(join(tmpdir(), "palamedes-build-env-"));
  const calls = [];
  const cargo = t.mock.method(childProcess, "execFileSync", (...args) => {
    calls.push(args);
    return "";
  });
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
    process.env.PALAMEDES_UPDATE_ENDPOINT =
      "https://sebastian-app-tracking.b-cdn.net/v1/versions/palamedes/github/stable";
    build();
    delete process.env.PALAMEDES_UPDATE_ENDPOINT;
    build();
    assert.equal(calls.length, 2);
    assert.equal(calls[0][0], "cargo");
    assert.deepEqual(calls[0][1].slice(0, 3), ["build", "--package", "palamedes-cli"]);
    assert.equal(
      calls[0][2].env.PALAMEDES_UPDATE_ENDPOINT,
      "https://sebastian-app-tracking.b-cdn.net/v1/versions/palamedes/github/stable",
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

test("CLI packaging uses Cargo-reported executable and OUT_DIR with separate build directories", async (t) => {
  const platform =
    process.platform === "win32"
      ? "win32-x64-msvc"
      : process.platform === "darwin" && process.arch === "arm64"
        ? "darwin-arm64"
        : process.platform === "linux"
          ? `linux-${process.arch}-${detectLinuxLibc() === "musl" ? "musl" : "gnu"}`
          : null;
  if (!platform) return t.skip("host has no CLI target package");
  const fs = await import("node:fs");
  const fixture = mkdtempSync(join(tmpdir(), "palamedes-cli-layout-"));
  const packageDir = join(fixture, "package");
  const originalDirectory = process.cwd();
  const executable = join(
    fixture,
    "custom-target",
    "debug",
    rustArtifactFileName({ name: "pmds", kind: "executable" }),
  );
  const outDir = join(fixture, "separate-build", "debug", "build", "cli-key", "out");
  fs.mkdirSync(packageDir, { recursive: true });
  fs.mkdirSync(join(outDir, "catalogs"), { recursive: true });
  fs.mkdirSync(join(fixture, "custom-target", "debug"), { recursive: true });
  writeFileSync(executable, "fixture executable");
  writeFileSync(join(outDir, "catalogs", "de.pmd.json"), "compiled German");
  writeFileSync(
    join(packageDir, "package.json"),
    JSON.stringify({ name: `@palamedes/cli-${platform}` }),
  );
  fs.mkdirSync(join(packageDir, "bin", "pmds-locales"), { recursive: true });
  writeFileSync(join(packageDir, "bin", "pmds-locales", "removed.pmd.json"), "obsolete");
  const messages = [
    {
      reason: "compiler-artifact",
      package_id: "cli-package",
      target: { name: "pmds" },
      executable,
    },
    { reason: "build-script-executed", package_id: "cli-package", out_dir: outDir },
    { reason: "build-script-executed", package_id: "another-package", out_dir: "wrong directory" },
  ];
  const cargo = t.mock.method(childProcess, "execFileSync", (command, args) => {
    assert.equal(command, "cargo");
    assert(args.includes("--message-format=json-render-diagnostics"));
    return messages.map((message) => JSON.stringify(message)).join("\n");
  });
  syncBuiltinESMExports();
  try {
    process.chdir(packageDir);
    await import(`../packages/cli/scripts/build-native.mjs?separate-build-directory`);
    assert.equal(
      fs.readFileSync(join(packageDir, "bin", pathBasename(executable)), "utf8"),
      "fixture executable",
    );
    assert.equal(
      fs.readFileSync(join(packageDir, "bin", "pmds-locales", "de.pmd.json"), "utf8"),
      "compiled German",
    );
    assert(!fs.existsSync(join(packageDir, "bin", "pmds-locales", "removed.pmd.json")));
    assert.equal(
      fs.readFileSync(
        join(fixture, "custom-target", "debug", "pmds-locales", "de.pmd.json"),
        "utf8",
      ),
      "compiled German",
    );
  } finally {
    process.chdir(originalDirectory);
    cargo.mock.restore();
    syncBuiltinESMExports();
    rmSync(fixture, { recursive: true, force: true });
  }
});
