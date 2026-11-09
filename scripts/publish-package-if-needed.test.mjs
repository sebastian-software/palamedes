import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

const script = path.resolve(import.meta.dirname, "publish-package-if-needed.mjs");
const licenseFiles = ["LICENSE-APACHE", "LICENSE-MIT"];

test("publishes JavaScript workspace dependencies before their dependents", (t) => {
  const fixture = publishFixture(t);
  fixture.package("dependent", "@example/dependent", { "@example/runtime": "workspace:^" });
  fixture.package("runtime", "@example/runtime");
  fixture.package("independent", "@example/independent");

  const result = fixture.publish();

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fixture.published(), [
    "./packages/independent",
    "./packages/runtime",
    "./packages/dependent",
  ]);
});

test("stops JavaScript publishing at the first failed package", (t) => {
  const fixture = publishFixture(t);
  fixture.package("dependent", "@example/dependent", { "@example/runtime": "workspace:^" });
  fixture.package("runtime", "@example/runtime");
  fixture.package("independent", "@example/independent");

  const result = fixture.publish({ failFilter: "./packages/runtime" });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /failed at @example\/runtime; aborting/u);
  assert.deepEqual(fixture.published(), ["./packages/independent", "./packages/runtime"]);
});

test("a dry run packs every JavaScript package in publish order without uploading", (t) => {
  const fixture = publishFixture(t);
  fixture.package("dependent", "@example/dependent", { "@example/runtime": "workspace:^" });
  fixture.package(
    "runtime",
    "@example/runtime",
    {},
    {
      optionalDependencies: { "@palamedes/core-node-linux-x64-gnu": "workspace:*" },
    },
  );
  fixture.package(
    "runtime-linux-x64",
    "@palamedes/core-node-linux-x64-gnu",
    {},
    {
      os: ["linux"],
      cpu: ["x64"],
      main: "./runtime.node",
    },
  );

  for (const viewState of ["missing", "found"]) {
    const result = fixture.publish({ dryRun: true, viewState });

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /@example\/runtime@1\.0\.0 packs a valid release manifest \(@palamedes\/core-node-linux-x64-gnu@1\.0\.0\)/u,
    );
    assert.match(
      result.stdout,
      /@example\/dependent@1\.0\.0 packs a valid release manifest \(@example\/runtime@\^1\.0\.0\)/u,
    );
  }
  assert.deepEqual(fixture.published(), [
    "pack @example/runtime",
    "pack @example/dependent",
    "pack @example/runtime",
    "pack @example/dependent",
  ]);
});

test("a dry run fails when a packed manifest keeps a workspace reference", (t) => {
  const fixture = publishFixture(t);
  fixture.package("dependent", "@example/dependent", { "@example/runtime": "workspace:^" });
  fixture.package("runtime", "@example/runtime");

  const result = fixture.publish({ dryRun: true, packLeak: "@example/runtime" });

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /dependencies\.@example\/runtime still uses workspace:\^ after packing/u,
  );
  assert.match(result.stderr, /failed at @example\/dependent; aborting/u);
  assert.deepEqual(fixture.published(), ["pack @example/runtime", "pack @example/dependent"]);
});

for (const licenseFile of licenseFiles) {
  test(`a dry run rejects a tarball missing ${licenseFile}`, (t) => {
    const fixture = publishFixture(t);
    fixture.package("runtime", "@example/runtime");

    const result = fixture.publish({ dryRun: true, omitLicense: licenseFile });

    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`missing or incorrect ${licenseFile}`, "u"));
  });
}

test("a dry run rejects a tarball with an incorrect license text", (t) => {
  const fixture = publishFixture(t);
  fixture.package("runtime", "@example/runtime");

  const result = fixture.publish({ dryRun: true, corruptLicense: "LICENSE-MIT" });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing or incorrect LICENSE-MIT/u);
});

test("a dry run ships both license texts with the real pnpm pack from a clean package", (t) => {
  const fixture = publishFixture(t);
  fixture.package("runtime", "@example/runtime", {}, { files: licenseFiles });

  const result = fixture.publish({ dryRun: true, realPack: true });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /packs a valid release manifest/u);
  assert.deepEqual(fixture.published(), ["pack @example/runtime"]);
});

function publishFixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "palamedes-publish-packages-"));
  const binDirectory = path.join(root, "bin");
  const logPath = path.join(root, "publish.log");
  mkdirSync(path.join(root, "packages"), { recursive: true });
  mkdirSync(binDirectory);
  for (const licenseFile of licenseFiles) {
    writeFileSync(path.join(root, licenseFile), `${licenseFile} fixture text\n`);
  }
  writeFileSync(
    path.join(binDirectory, "pnpm"),
    `#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process"
import assert from "node:assert/strict"
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const args = process.argv.slice(2)
if (args[0] === "view") {
  if (process.env.VIEW_STATE === "found") {
    process.stdout.write("1.0.0\\n")
    process.exit(0)
  }
  process.stderr.write("404 Not Found\\n")
  process.exit(1)
}
if (args[0] === "--filter" && args[2] === "publish") {
  for (const licenseFile of ["LICENSE-APACHE", "LICENSE-MIT"]) {
    assert.equal(
      readFileSync(path.join(args[1], licenseFile), "utf8"),
      readFileSync(licenseFile, "utf8"),
    )
  }
  appendFileSync(process.env.PUBLISH_LOG, args[1] + "\\n")
  process.exit(args[1] === process.env.FAIL_FILTER ? 1 : 0)
}
if (args[0] === "pack" && args[1] === "--pack-destination") {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"))
  appendFileSync(process.env.PUBLISH_LOG, "pack " + manifest.name + "\\n")
  if (process.env.REAL_PACK === "true") {
    const result = spawnSync("pnpm", args, {
      env: { ...process.env, PATH: process.env.REAL_PATH },
      stdio: "inherit",
      shell: process.platform === "win32",
    })
    process.exit(result.status ?? 1)
  }
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    for (const [name, specifier] of Object.entries(manifest[field] ?? {})) {
      if (!specifier.startsWith("workspace:") || process.env.PACK_LEAK === name) continue
      const range = specifier.slice("workspace:".length)
      manifest[field][name] = range === "*" ? "1.0.0" : range === "^" ? "^1.0.0" : range
    }
  }
  const staging = mkdtempSync(path.join(args[2], "staging-"))
  mkdirSync(path.join(staging, "package"))
  writeFileSync(path.join(staging, "package", "package.json"), JSON.stringify(manifest))
  for (const licenseFile of ["LICENSE-APACHE", "LICENSE-MIT"]) {
    if (licenseFile === process.env.OMIT_LICENSE) continue
    const content = licenseFile === process.env.CORRUPT_LICENSE
      ? "incorrect license"
      : readFileSync(licenseFile, "utf8")
    writeFileSync(path.join(staging, "package", licenseFile), content)
  }
  execFileSync("tar", ["-czf", path.join(args[2], "package.tgz"), "-C", staging, "package"])
  process.exit(0)
}
process.exit(1)
`,
  );
  chmodSync(path.join(binDirectory, "pnpm"), 0o755);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  return {
    package(directory, name, dependencies = {}, fields = {}) {
      const packageDirectory = path.join(root, "packages", directory);
      mkdirSync(packageDirectory);
      writeFileSync(
        path.join(packageDirectory, "package.json"),
        JSON.stringify({ name, version: "1.0.0", dependencies, ...fields }),
      );
    },
    publish({
      dryRun = false,
      failFilter,
      packLeak,
      viewState,
      omitLicense,
      corruptLicense,
      realPack = false,
    } = {}) {
      return spawnSync(process.execPath, [script, "--all-js", ...(dryRun ? ["--dry-run"] : [])], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          FAIL_FILTER: failFilter,
          OMIT_LICENSE: omitLicense,
          CORRUPT_LICENSE: corruptLicense,
          REAL_PACK: String(realPack),
          REAL_PATH: process.env.PATH,
          PACK_LEAK: packLeak,
          VIEW_STATE: viewState,
          PATH: `${binDirectory}${path.delimiter}${process.env.PATH}`,
          PUBLISH_LOG: logPath,
        },
      });
    },
    published() {
      try {
        return readFileSync(logPath, "utf8").trim().split("\n");
      } catch (error) {
        if (error.code === "ENOENT") {
          return [];
        }
        throw error;
      }
    },
  };
}
