import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  assertPublishedArchive,
  assertRustPublication,
  publishRustSdk,
} from "./publish-rust-sdk.mjs";
import {
  indexPath,
  assertArchiveContents,
  registryJson,
  RUST_SDK_PACKAGES,
  RUST_SDK_REPOSITORY,
  waitForRegistryVersion,
} from "./rust-sdk-packages.mjs";

const packages = RUST_SDK_PACKAGES.map((name) => ({
  name,
  version: "2.0.0",
  publish: ["crates-io"],
}));
const policy = { publicationEnabled: true, minimumMajor: 2, reason: "test" };
const environment = { CARGO_REGISTRY_TOKEN: "fixture", PALAMEDES_CRATES_OWNER: "owner" };

function allowedArchiveFiles(name) {
  return [
    ".cargo_vcs_info.json",
    "Cargo.toml",
    "Cargo.toml.orig",
    "Cargo.lock",
    "LICENSE-MIT",
    "LICENSE-APACHE",
    name === "palamedes" ? "crates/palamedes/README.md" : "README.md",
    name === "palamedes" ? "crates/palamedes/src/lib.rs" : "src/lib.rs",
  ];
}

test("Archive allowlists reject recursively matched dependencies, generated outputs, and unrelated files", () => {
  for (const name of RUST_SDK_PACKAGES) {
    const files = allowedArchiveFiles(name);
    assert.doesNotThrow(() => assertArchiveContents(name, files));
    const source = name === "palamedes" ? "crates/palamedes/src/" : "src/";
    for (const leaked of [
      "benchmarks/lingui-v6/node_modules/some-package/LICENSE-MIT",
      "node_modules/example/README.md",
      "target/debug/greeting",
      "dist/index.js",
      "unrelated.txt",
      `${source}node_modules/example/LICENSE-MIT`,
      `${source}target/generated.rs`,
    ]) {
      assert.throws(() => assertArchiveContents(name, [...files, leaked]), /unexpected path/);
    }
    assert.throws(
      () =>
        assertArchiveContents(
          name,
          files.filter((file) => file !== "LICENSE-MIT"),
        ),
      /misses LICENSE-MIT/,
    );
  }
});

test("Rust publishing requires the policy, stable coordinated versions, manifest allowlists, and credentials", () => {
  assert.doesNotThrow(() => assertRustPublication(policy, packages, environment));
  assert.throws(
    () => assertRustPublication({ ...policy, publicationEnabled: false }, packages, environment),
    /Release hold/,
  );
  for (const version of ["1.25.1", "2.0.0-rc.1"]) {
    assert.throws(
      () =>
        assertRustPublication(
          policy,
          packages.map((pkg) => ({ ...pkg, version })),
          environment,
        ),
      /stable version/,
    );
  }
  assert.throws(
    () =>
      assertRustPublication(
        policy,
        [packages[0], { ...packages[1], version: "2.1.0" }],
        environment,
      ),
    /versions must match/,
  );
  assert.throws(
    () => assertRustPublication(policy, [{ ...packages[0], publish: [] }], environment),
    /explicitly allow/,
  );
  assert.throws(() => assertRustPublication(policy, packages, {}), /CARGO_REGISTRY_TOKEN/);
  assert.throws(
    () => assertRustPublication(policy, packages, { CARGO_REGISTRY_TOKEN: "fixture" }),
    /OWNER/,
  );
});

test("Already-published versions are skipped only when the exact archive matches and is not yanked", () => {
  assert.doesNotThrow(() =>
    assertPublishedArchive({ checksum: "same", yanked: false }, "same", packages[0]),
  );
  for (const version of [{ checksum: "other" }, { checksum: "same", yanked: true }]) {
    assert.throws(
      () => assertPublishedArchive(version, "same", packages[0]),
      /differs or is yanked/,
    );
  }
});

test("Registry errors cannot masquerade as name/version availability", async () => {
  assert.equal(
    await registryJson("https://example.invalid", {
      fetchImpl: async () => new Response("", { status: 404 }),
    }),
    null,
  );
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(
      registryJson("https://example.invalid", {
        fetchImpl: async () => new Response("", { status }),
      }),
      new RegExp(`HTTP ${status}`),
    );
  }
});

test("Registry propagation waits for the exact indexed archive, with a finite retry budget", async () => {
  let calls = 0;
  const pauses = [];
  await waitForRegistryVersion(packages[0], "same", {
    fetchImpl: async () =>
      ++calls < 3
        ? new Response("", { status: 404 })
        : new Response(JSON.stringify({ vers: "2.0.0", cksum: "same", yanked: false })),
    pause: async (ms) => pauses.push(ms),
  });
  assert.equal(calls, 3);
  assert.deepEqual(pauses, [15_000, 15_000]);
  calls = 0;
  await assert.rejects(
    waitForRegistryVersion(packages[0], "same", {
      async fetchImpl() {
        calls++;
        return new Response("", { status: 404 });
      },
      async pause() {},
      attempts: 3,
    }),
    /timed out/,
  );
  assert.equal(calls, 3);
  for (const entry of [
    { vers: "2.0.0", cksum: "other" },
    { vers: "2.0.0", cksum: "same", yanked: true },
  ]) {
    await assert.rejects(
      waitForRegistryVersion(packages[0], "same", {
        fetchImpl: async () => new Response(JSON.stringify(entry)),
      }),
      /differs or is yanked/,
    );
  }
  await assert.rejects(
    waitForRegistryVersion(packages[0], "same", {
      fetchImpl: async () => new Response("", { status: 403 }),
    }),
    /HTTP 403/,
  );
});

test("The Cargo lane retains both independent publication guards and its verified dry run", async () => {
  for (const file of [
    "Cargo.toml",
    "crates/palamedes-i18n/Cargo.toml",
    "crates/palamedes-build/Cargo.toml",
  ]) {
    const manifest = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(manifest, /publish = false/);
    const includes = manifest.match(/include = \[([^\]]+)\]/u)?.[1].match(/"([^"]+)"/gu) ?? [];
    assert(
      includes.length > 0 && includes.every((entry) => entry.startsWith('"/')),
      `${file} must anchor every include path`,
    );
  }
  const workflow = await readFile(
    new URL("../.github/workflows/publish.yml", import.meta.url),
    "utf8",
  );
  const cargoJob = workflow.slice(
    workflow.indexOf("  publish-cargo:"),
    workflow.indexOf("  publish-js:"),
  );
  assert.match(cargoJob, /validate-release/);
  assert.match(cargoJob, /needs.determine-release.outputs.should_publish == 'true'/);
  assert.match(cargoJob, /inputs.dry_run/);
  assert.match(workflow, /node .\/scripts\/publish-rust-sdk.mjs --dry-run/);
  assert.match(cargoJob, /secrets.CARGO_REGISTRY_TOKEN/);
  assert.match(cargoJob, /vars.CRATES_IO_OWNER/);
  assert.equal(indexPath("palamedes"), "pa/la/palamedes");
});

test("The publisher orders verified archives, skips exact versions, and stops before dependents on failure", async () => {
  const events = [];
  let failing = false;
  let leaking = false;
  const services = {
    async metadata() {
      return packages;
    },
    policy() {
      return policy;
    },
    async registry(url) {
      if (url.endsWith("/owners")) return { users: [{ login: "owner" }] };
      if (url.endsWith("/2.0.0"))
        return url.includes("palamedes-i18n/")
          ? { version: { checksum: "same", yanked: false } }
          : null;
      return { crate: { repository: RUST_SDK_REPOSITORY } };
    },
    async checksumOf() {
      return "same";
    },
    async execute(command, args) {
      if (command === "tar") {
        const name = RUST_SDK_PACKAGES.find((name) => args[1].endsWith(`${name}-2.0.0.crate`));
        const files = allowedArchiveFiles(name);
        if (leaking && name === "palamedes") files.push("node_modules/example/LICENSE-MIT");
        return files.map((file) => `${name}-2.0.0/${file}`).join("\n");
      }
      assert.equal(command, "cargo");
      assert.equal(args[args.indexOf("--registry") + 1], "crates-io");
      const event = `${args[0]}:${args[args.indexOf("-p") + 1]}`;
      events.push(event);
      if (failing && event === "publish:palamedes") throw new Error("upload failed");
    },
    async wait(pkg) {
      events.push(`visible:${pkg.name}`);
    },
  };
  await publishRustSdk("/fixture", environment, services);
  assert.deepEqual(events, [
    "package:palamedes-i18n",
    "visible:palamedes-i18n",
    "package:palamedes",
    "publish:palamedes",
    "visible:palamedes",
    "package:palamedes-build",
    "publish:palamedes-build",
    "visible:palamedes-build",
  ]);
  events.length = 0;
  failing = true;
  await assert.rejects(publishRustSdk("/fixture", environment, services), /upload failed/);
  assert.deepEqual(events, [
    "package:palamedes-i18n",
    "visible:palamedes-i18n",
    "package:palamedes",
    "publish:palamedes",
  ]);
  events.length = 0;
  failing = false;
  leaking = true;
  await assert.rejects(publishRustSdk("/fixture", environment, services), /unexpected path/);
  assert.deepEqual(events, [
    "package:palamedes-i18n",
    "visible:palamedes-i18n",
    "package:palamedes",
  ]);
});
