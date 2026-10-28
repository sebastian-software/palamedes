import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertPublishedArchive,
  assertRustPublication,
  preflightRustSdk,
  publishRustSdk,
} from "./publish-rust-sdk.mjs";
import {
  cargoManifestVersion,
  indexPath,
  assertArchiveContents,
  registryJson,
  RUST_SDK_PACKAGES,
  RUST_SDK_REPOSITORY,
  sdkManifestVersions,
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

test("The Cargo preflight proves readiness from the policy, manifests, token exchange, and registry without uploading", async () => {
  const requests = [];
  const crates = {
    "palamedes-i18n": { crate: { repository: RUST_SDK_REPOSITORY } },
    palamedes: { crate: { repository: RUST_SDK_REPOSITORY } },
    "palamedes-build": { crate: { repository: RUST_SDK_REPOSITORY } },
  };
  let versions = {};
  let owners = [{ login: "owner" }];
  const preflightEnvironment = {
    PALAMEDES_CRATES_OWNER: "owner",
    PALAMEDES_CRATES_TOKEN_ISSUED: "true",
  };
  const services = (overrides = {}) => ({
    async metadata() {
      return packages;
    },
    policy() {
      return policy;
    },
    async registry(url) {
      requests.push(url);
      const [, name, rest] = /\/crates\/([^/]+)(?:\/(.+))?$/u.exec(url);
      if (rest === "owners") return { users: owners };
      if (rest) return versions[`${name}@${rest}`] ?? null;
      return crates[name] ?? null;
    },
    log() {},
    ...overrides,
  });

  await preflightRustSdk("/fixture", preflightEnvironment, services());
  assert.deepEqual(
    requests.filter((url) => !url.endsWith("/owners") && !url.endsWith("/2.0.0")),
    RUST_SDK_PACKAGES.map((name) => `https://crates.io/api/v1/crates/${name}`),
  );

  await assert.rejects(
    preflightRustSdk("/fixture", { PALAMEDES_CRATES_OWNER: "owner" }, services()),
    /did not issue a trusted publishing token/,
  );
  await assert.rejects(
    preflightRustSdk("/fixture", { PALAMEDES_CRATES_TOKEN_ISSUED: "true" }, services()),
    /PALAMEDES_CRATES_OWNER/,
  );
  await assert.rejects(
    preflightRustSdk(
      "/fixture",
      preflightEnvironment,
      services({ policy: () => ({ ...policy, publicationEnabled: false }) }),
    ),
    /Release hold/,
  );
  await assert.rejects(
    preflightRustSdk(
      "/fixture",
      preflightEnvironment,
      services({ metadata: async () => packages.map((pkg) => ({ ...pkg, publish: [] })) }),
    ),
    /explicitly allow crates-io/,
  );

  // A dry run needs no token and reports, rather than enforces, the release
  // hold, but it still checks the registry state.
  const held = services({
    policy: () => ({ ...policy, publicationEnabled: false }),
    metadata: async () => packages.map((pkg) => ({ ...pkg, publish: [] })),
  });
  await preflightRustSdk(
    "/fixture",
    { PALAMEDES_CRATES_OWNER: "owner" },
    { ...held, dryRun: true },
  );
  owners = [{ login: "someone-else" }];
  await assert.rejects(
    preflightRustSdk("/fixture", { PALAMEDES_CRATES_OWNER: "owner" }, { ...held, dryRun: true }),
    /owner is not a verified direct owner of palamedes-i18n/,
  );
  owners = [{ login: "owner" }];

  delete crates.palamedes;
  await assert.rejects(
    preflightRustSdk("/fixture", preflightEnvironment, services()),
    /palamedes does not exist on crates.io; trusted publishing cannot create a crate/,
  );
  crates.palamedes = { crate: { repository: "https://github.com/example/fork" } };
  await assert.rejects(
    preflightRustSdk("/fixture", preflightEnvironment, services()),
    /Registry repository differs for palamedes/,
  );
  crates.palamedes = { crate: { repository: RUST_SDK_REPOSITORY } };
  versions = { "palamedes-build@2.0.0": { version: { yanked: true } } };
  await assert.rejects(
    preflightRustSdk("/fixture", preflightEnvironment, services()),
    /palamedes-build@2.0.0 is yanked/,
  );
  versions = { "palamedes-build@2.0.0": { version: { yanked: false, checksum: "same" } } };
  await preflightRustSdk("/fixture", preflightEnvironment, services());
});

test("Already-published versions are skipped only when the exact archive matches and is not yanked", () => {
  assert.doesNotThrow(() =>
    assertPublishedArchive({ checksum: "same", yanked: false }, "same", packages[0]),
  );
  assert.throws(
    () => assertPublishedArchive({ checksum: "other" }, "same", packages[0]),
    /Already-published archive differs: palamedes-i18n@2\.0\.0.*original release revision/,
  );
  assert.throws(
    () => assertPublishedArchive({ checksum: "same", yanked: true }, "same", packages[0]),
    /Already-published version is yanked: palamedes-i18n@2\.0\.0/,
  );
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

test("The release sweep reads SDK versions without Cargo and accepts any unyanked indexed archive", async () => {
  assert.equal(
    cargoManifestVersion(
      '[package]\nname = "palamedes-i18n"\nversion = "2.0.0"\n\n[dependencies]\nserde = { version = "1" }\nversion = "9.9.9"\n',
    ),
    "2.0.0",
  );
  assert.throws(
    () =>
      cargoManifestVersion(
        '[package]\nversion.workspace = true\n\n[dependencies]\nversion = "1"\n',
      ),
    /no literal \[package\] version/,
  );
  const versions = await sdkManifestVersions(fileURLToPath(new URL("..", import.meta.url)));
  assert.deepEqual(
    versions.map((pkg) => pkg.name),
    RUST_SDK_PACKAGES,
  );
  assert.equal(new Set(versions.map((pkg) => pkg.version)).size, 1);

  await waitForRegistryVersion(packages[0], null, {
    fetchImpl: async () => new Response(JSON.stringify({ vers: "2.0.0", cksum: "any" })),
  });
  await assert.rejects(
    waitForRegistryVersion(packages[0], null, {
      fetchImpl: async () =>
        new Response(JSON.stringify({ vers: "2.0.0", cksum: "any", yanked: true })),
    }),
    /differs or is yanked/,
  );
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

test("The Cargo lane allows only crates.io for the SDK, keeps other crates unpublished, and retains its verified dry run", async () => {
  for (const file of [
    "Cargo.toml",
    "crates/palamedes-i18n/Cargo.toml",
    "crates/palamedes-build/Cargo.toml",
  ]) {
    const manifest = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(manifest, /^publish = \["crates-io"\]$/mu);
    const includes = manifest.match(/include = \[([^\]]+)\]/u)?.[1].match(/"([^"]+)"/gu) ?? [];
    assert(
      includes.length > 0 && includes.every((entry) => entry.startsWith('"/')),
      `${file} must anchor every include path`,
    );
  }
  // The CLI, Node binding, and plugin SDK are not part of the Cargo lane.
  for (const file of [
    "crates/palamedes-cli/Cargo.toml",
    "crates/palamedes-node/Cargo.toml",
    "crates/palamedes-plugin/Cargo.toml",
  ]) {
    const manifest = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(manifest, /^publish = false$/mu, `${file} must stay unpublished`);
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
  assert.match(cargoJob, /vars.CRATES_IO_OWNER/);
  assert.equal(indexPath("palamedes"), "pa/la/palamedes");
});

test("Cargo OIDC stays in the guarded publish job and supplies only the upload step", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/publish.yml", import.meta.url),
    "utf8",
  );
  const cargoJob = workflow.slice(
    workflow.indexOf("  publish-cargo:"),
    workflow.indexOf("  publish-js:"),
  );
  const validationJob = workflow.slice(
    workflow.indexOf("  validate-release:"),
    workflow.indexOf("  publish-native:"),
  );
  const header = workflow.slice(0, workflow.indexOf("jobs:"));
  assert.match(cargoJob, /github\.event_name != 'workflow_dispatch' \|\| !inputs\.dry_run/);
  assert.match(cargoJob, /permissions:\n {6}contents: read\n {6}id-token: write/);
  assert.doesNotMatch(header, /^ {2}id-token:/m);
  assert.doesNotMatch(validationJob, /id-token: write|crates-io-auth-action|CARGO_REGISTRY_TOKEN/);
  assert.doesNotMatch(cargoJob, /secrets\.|environment:|continue-on-error:|always\(\)/);

  const auth = cargoJob.indexOf("      - name: Authenticate to crates.io with OIDC");
  const publish = cargoJob.indexOf("      - name: Publish Cargo SDK in dependency order");
  assert(auth > cargoJob.indexOf("uses: ./.github/actions/setup-workspace"));
  assert(publish > auth);
  assert.match(
    cargoJob.slice(auth, publish),
    /id: crates-auth\n {8}uses: rust-lang\/crates-io-auth-action@[a-f0-9]{40} # v\d+\.\d+\.\d+/,
  );
  assert.match(
    cargoJob.slice(publish),
    /env:\n {10}CARGO_REGISTRY_TOKEN: \$\{\{ steps.crates-auth.outputs.token \}\}/,
  );
  assert.equal(cargoJob.match(/CARGO_REGISTRY_TOKEN/g)?.length, 1);
  assert.doesNotMatch(workflow, /secrets\.CARGO_REGISTRY_TOKEN/);
});

test("The publisher orders verified archives, skips exact versions, and stops before dependents on failure", async () => {
  const events = [];
  let failing = false;
  let leaking = false;
  let checksum = "same";
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
      return checksum;
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
  checksum = "changed-revision";
  await assert.rejects(
    publishRustSdk("/fixture", environment, services),
    /Already-published archive differs/,
  );
  assert.deepEqual(events, ["package:palamedes-i18n"]);
  events.length = 0;
  checksum = "same";
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
