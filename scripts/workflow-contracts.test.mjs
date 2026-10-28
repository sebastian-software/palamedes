import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { checkWorkflowPins, unpinnedActionReferences } from "./check-workflow-pins.mjs";
import { COVERAGE_GATES } from "./coverage-gate.mjs";
import { selectScreenshotExamples } from "./example-matrix.mjs";
import {
  assertEnabledCacheContents,
  assertNetworkIsolation,
  enabledBuildArtifacts,
} from "./check-enabled-update-check.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const rustVersion = (await readFile(resolve(repositoryRoot, "Cargo.toml"), "utf8")).match(
  /^rust-version\s*=\s*"([^"]+)"/mu,
)?.[1];
if (!rustVersion) throw new Error("Missing workspace rust-version");

async function readRepositoryFile(path) {
  return readFile(resolve(repositoryRoot, path), "utf8");
}

function job(workflow, name, nextName) {
  const start = workflow.indexOf(`  ${name}:`);
  const next = workflow.indexOf(`  ${nextName}:`, start + 1);
  const end = next === -1 ? workflow.length : next;

  if (start === -1) {
    throw new Error(`Could not find ${name} job boundary`);
  }

  return workflow.slice(start, end);
}

// Reads the job graph of a workflow with the repository's two-space layout:
// each job's `needs`, `if`, and its steps' `if` and full text.
function workflowJobs(workflow) {
  const jobs = new Map();
  let current;
  let step;
  let inNeeds = false;
  for (const line of workflow.slice(workflow.indexOf("\njobs:\n") + 7).split("\n")) {
    let match;
    if ((match = /^ {2}([a-z0-9-]+):$/u.exec(line))) {
      current = { name: match[1], needs: [], if: "", steps: [], text: "" };
      jobs.set(current.name, current);
      step = undefined;
      inNeeds = false;
      continue;
    }
    if (!current) continue;
    current.text += `${line}\n`;
    if ((match = /^ {4}needs: (\S+)$/u.exec(line))) {
      current.needs.push(match[1]);
      continue;
    }
    if (/^ {4}needs:$/u.test(line)) {
      inNeeds = true;
      continue;
    }
    if (inNeeds && (match = /^ {6}- (\S+)$/u.exec(line))) {
      current.needs.push(match[1]);
      continue;
    }
    inNeeds = false;
    if ((match = /^ {4}if: (.+)$/u.exec(line))) current.if = match[1];
    if ((match = /^ {6}- name: (.+)$/u.exec(line))) {
      step = { name: match[1], if: "", text: "" };
      current.steps.push(step);
      continue;
    }
    if (step) {
      step.text += `${line}\n`;
      if ((match = /^ {8}if: (.+)$/u.exec(line))) step.if = match[1];
    }
  }
  return jobs;
}

function transitiveNeeds(jobs, name, seen = new Set()) {
  for (const need of jobs.get(name)?.needs ?? []) {
    if (!seen.has(need)) {
      seen.add(need);
      transitiveNeeds(jobs, need, seen);
    }
  }
  return seen;
}

// Steps that can upload to npm or crates.io. The packing check and the Cargo
// preflight pass `--dry-run` or `--preflight` and stay out of this set.
function uploadsToRegistry(stepText) {
  return (
    /publish-package-if-needed\.mjs(?![^\n]*--dry-run)/u.test(stepText) ||
    /publish-rust-sdk\.mjs\s*$/mu.test(stepText) ||
    /\b(?:npm|pnpm|cargo) publish\b/u.test(stepText)
  );
}

describe("workflow contracts", () => {
  it("keeps native fuzzing bounded, isolated, and separate from normal Rust gates", async () => {
    const workflow = await readRepositoryFile(".github/workflows/native-fuzz.yml");
    const runner = await readRepositoryFile("scripts/fuzz-native.mjs");
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("schedule:");
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("timeout-minutes: 45");
    expect(workflow).toContain("cargo install cargo-fuzz --version 0.13.2 --locked");
    expect(workflow).toContain("manifest-path: fuzz/Cargo.toml");
    expect(workflow).toContain("nightly-2026-07-20");
    expect(workflow).toContain("'smoke' || 'scheduled'");
    expect(workflow).not.toMatch(/secrets\.|pull_request_target|continue-on-error/u);
    for (const flag of [
      "-seed=1311",
      "-max_len=65536",
      "-timeout=5",
      "-rss_limit_mb=2048",
      "-malloc_limit_mb=256",
    ])
      expect(runner).toContain(flag);
    expect(runner).toContain("lockBefore");
    expect(runner).toContain("offline: true");
    expect(runner).toContain('child.kill("SIGKILL")');
    expect(workflow).toContain("fuzz/artifacts/");
    expect(workflow).toContain("fuzz/target/run-*/");
  });

  it("keeps paid benchmark VMs manual and retains separate, paired Linux/macOS evidence", async () => {
    const workflow = await readRepositoryFile(".github/workflows/blacksmith-benchmarks.yml");
    const triggers = workflow.slice(workflow.indexOf("on:"), workflow.indexOf("permissions:"));
    expect(triggers).toContain("workflow_dispatch:");
    expect(triggers).not.toMatch(/pull_request:|push:|schedule:/u);
    expect(workflow).toContain("contents: read");
    const compare = job(workflow, "compare", "merge");
    expect(compare).toContain("blacksmith-6vcpu-macos-26");
    expect(compare).toContain("blacksmith-4vcpu-ubuntu-2404");
    expect(compare).toContain("run: [1, 2, 3]");
    expect(compare).toContain("if: always()");
    expect(compare).toContain("persist-credentials: false");
    const merge = job(workflow, "merge", "missing");
    expect(merge).toContain("!cancelled()");
    expect(merge).toContain(
      "shard-benchmarks-${{ matrix.profile }}-run*-${{ github.run_id }}-${{ github.run_attempt }}",
    );
    for (const repetition of [1, 2, 3])
      expect(merge).toContain(`$PROFILE-run${repetition}-$SUFFIX`);
    expect(merge).toContain('--revision "$GITHUB_SHA"');
  });

  it("holds package release creation and publication while retaining a non-publishing dry run", async () => {
    const [release, publish, detection] = await Promise.all([
      readRepositoryFile(".github/workflows/release-pr.yml"),
      readRepositoryFile(".github/workflows/publish.yml"),
      readRepositoryFile("scripts/determine-release.mjs"),
    ]);
    expect(release).toContain("run: node ./scripts/release-policy.mjs");
    expect(release).toContain("if: steps.policy.outputs.publication_enabled == 'true'");
    expect(publish).toContain(
      "DRY_RUN: ${{ github.event_name == 'workflow_dispatch' && inputs.dry_run && 'true' || 'false' }}",
    );
    expect(detection).toContain("publicationAllowed(policy, version)");
    const dryRunGate = "github.event_name != 'workflow_dispatch' || !inputs.dry_run";
    const gated = [];
    for (const releaseJob of workflowJobs(publish).values()) {
      for (const step of releaseJob.steps) {
        if (
          uploadsToRegistry(step.text) ||
          /check-published-(?:versions|crates)|crates-io-auth-action/u.test(step.text)
        ) {
          gated.push(step.name);
          expect(`${releaseJob.if}\n${step.if}`, step.name).toContain(dryRunGate);
        }
      }
    }
    expect(gated).toEqual(
      expect.arrayContaining([
        "Exchange GitHub OIDC for a crates.io token",
        "Publish native package",
        "Authenticate to crates.io with OIDC",
        "Publish Cargo SDK in dependency order",
        "Publish JavaScript packages",
        "Verify every package reached the registry",
        "Verify every Cargo SDK crate reached crates.io",
      ]),
    );
  });

  it("starts no registry upload before the Cargo preflight, the JavaScript pack check, and the browser proofs pass", async () => {
    const publish = await readRepositoryFile(".github/workflows/publish.yml");
    const jobs = workflowJobs(publish);
    const uploadJobs = [...jobs.values()]
      .filter((releaseJob) => releaseJob.steps.some((step) => uploadsToRegistry(step.text)))
      .map((releaseJob) => releaseJob.name);

    expect(uploadJobs.sort()).toEqual(["publish-cargo", "publish-js", "publish-native"]);
    for (const name of uploadJobs) {
      const upstream = transitiveNeeds(jobs, name);
      expect(upstream.has("preflight-cargo"), name).toBe(true);
      expect(upstream.has("validate-release"), name).toBe(true);
      expect(upstream.has("example-verification"), name).toBe(true);
      // A status function would let the job start after a failed preflight.
      for (const jobName of [name, ...upstream]) {
        expect(jobs.get(jobName).if, jobName).not.toMatch(/always\(\)|failure\(\)|cancelled\(\)/u);
      }
      expect(jobs.get(name).text).not.toContain("continue-on-error");
    }

    const preflight = jobs.get("preflight-cargo");
    expect(preflight.needs).toEqual(["determine-release"]);
    expect(preflight.if).toBe("needs.determine-release.outputs.should_publish == 'true'");
    expect(preflight.text).toMatch(/permissions:\n {6}contents: read\n {6}id-token: write/u);
    expect(preflight.text).not.toMatch(/continue-on-error|secrets\.|CARGO_REGISTRY_TOKEN/u);
    expect(preflight.steps.map((step) => step.name)).toEqual([
      "Check out repository",
      "Set up workspace",
      "Exchange GitHub OIDC for a crates.io token",
      "Check Cargo release readiness without uploading",
    ]);
    const [exchange, readiness] = preflight.steps.slice(2);
    expect(exchange.text).toMatch(
      /id: crates-auth\n {8}if: .+\n {8}uses: rust-lang\/crates-io-auth-action@[a-f0-9]{40} # v\d+\.\d+\.\d+/u,
    );
    expect(readiness.text).toContain("PALAMEDES_CRATES_OWNER: ${{ vars.CRATES_IO_OWNER }}");
    expect(readiness.text).toContain(
      "PALAMEDES_CRATES_TOKEN_ISSUED: ${{ steps.crates-auth.outputs.token != '' }}",
    );
    expect(readiness.text).toContain(
      "run: node ./scripts/publish-rust-sdk.mjs --preflight ${{ (github.event_name == 'workflow_dispatch' && inputs.dry_run) && '--dry-run' || '' }}",
    );

    const validate = jobs.get("validate-release");
    const stepNames = validate.steps.map((step) => step.name);
    const pack = validate.steps.find(
      (step) => step.name === "Pack JavaScript packages and verify release manifests",
    );
    expect(pack.text).toContain(
      "run: node ./scripts/publish-package-if-needed.mjs --all-js --dry-run",
    );
    expect(pack.if).toBe("");
    expect(stepNames.indexOf(pack.name)).toBeGreaterThan(stepNames.indexOf("Build packages"));
    // Packing runs where no publishing credential exists.
    expect(validate.text).not.toMatch(/id-token: write|registry-url|NODE_AUTH_TOKEN|secrets\./u);
  });

  it("finds enabled-proof catalogs independently of the Cargo executable directory", () => {
    const artifact = {
      reason: "compiler-artifact",
      package_id: "cli",
      target: { name: "pmds" },
      executable: "/target/debug/pmds",
    };
    const messages = [
      { reason: "build-script-executed", package_id: "other", out_dir: "/wrong" },
      {
        reason: "build-script-executed",
        package_id: "cli",
        out_dir: "/separate-build/debug/build/cli/out",
      },
      artifact,
    ];
    const json = (items) => items.map((item) => JSON.stringify(item)).join("\n");
    expect(enabledBuildArtifacts(json(messages))).toEqual({
      binary: "/target/debug/pmds",
      catalogDirectory: join("/separate-build/debug/build/cli/out", "catalogs"),
    });
    expect(() => enabledBuildArtifacts(json([artifact]))).toThrow("catalog output directory");
    expect(() => enabledBuildArtifacts(json([]))).toThrow("pmds executable");
  });

  it("validates the shared client's failed-attempt cache without a legacy cohort", () => {
    const valid = {
      schema_version: 1,
      resource: "https://sebastian-app-tracking.b-cdn.net/v1/versions/palamedes/github/stable",
      next_check: 1_788_773_977,
      failures: 1,
      release: null,
    };
    expect(() => assertEnabledCacheContents(JSON.stringify(valid))).not.toThrow();
    for (const change of [
      { schema_version: 2 },
      { resource: "https://example.invalid" },
      { next_check: 0 },
      { failures: 0 },
      { release: {} },
    ]) {
      expect(() => assertEnabledCacheContents(JSON.stringify({ ...valid, ...change }))).toThrow();
    }
    expect(() => assertEnabledCacheContents("1788773977\n")).toThrow();
  });

  it("embeds the exact update endpoint only in all six native release build paths", async () => {
    const [publish, ci, musl, cliBuild, nativeBuild] = await Promise.all([
      readRepositoryFile(".github/workflows/publish.yml"),
      readRepositoryFile(".github/workflows/ci.yml"),
      readRepositoryFile(".github/actions/verify-musl-native/action.yml"),
      readRepositoryFile("packages/cli/scripts/build-native.mjs"),
      readRepositoryFile("scripts/build-native-lib.mjs"),
    ]);
    const native = job(publish, "publish-native", "publish-js");
    const header = native.slice(0, native.indexOf("    steps:"));
    expect(header).toMatch(
      /^ {4}env:\n(?: {6}.+\n)* {6}PALAMEDES_UPDATE_ENDPOINT: https:\/\/sebastian-app-tracking\.b-cdn\.net\/v1\/versions\/palamedes\/github\/stable$/mu,
    );
    expect(publish.match(/PALAMEDES_UPDATE_ENDPOINT/gu)).toHaveLength(1);
    expect(ci).not.toContain("PALAMEDES_UPDATE_ENDPOINT:");
    expect(musl).not.toContain("PALAMEDES_UPDATE_ENDPOINT:");
    const targets = [
      "darwin-arm64",
      "linux-x64-gnu",
      "linux-arm64-gnu",
      "linux-x64-musl",
      "linux-arm64-musl",
      "win32-x64-msvc",
    ];
    expect(native.match(/package_name: "@palamedes\/cli-/gu)).toHaveLength(targets.length);
    for (const target of targets) {
      expect(native).toContain(`package_name: "@palamedes/cli-${target}"`);
      expect(cliBuild).toContain(`"@palamedes/cli-${target}":`);
      const manifest = JSON.parse(await readRepositoryFile(`packages/cli-${target}/package.json`));
      expect(manifest.scripts.build).toBe("node ../cli/scripts/build-native.mjs --if-compatible");
    }
    expect(native).toContain("if: matrix.rust_target == ''\n        run: pnpm --filter");
    expect(native).toContain("uses: ./.github/actions/verify-musl-native");
    expect(musl).toContain('run: pnpm --filter "${{ inputs.package_name }}" build');
    expect(cliBuild).toContain('cargoPackage: "palamedes-cli"');
    expect(nativeBuild).toContain("const cargoEnv = { ...process.env }");
    expect(nativeBuild).toContain("env: cargoEnv");
  });

  it("opts native and container release smoke processes out without packaging a default", async () => {
    const [publish, musl] = await Promise.all([
      readRepositoryFile(".github/workflows/publish.yml"),
      readRepositoryFile(".github/actions/verify-musl-native/action.yml"),
    ]);
    const nativeSmoke = publish
      .split("- name: Smoke-test native CLI package")[1]
      .split("- name:")[0];
    expect(nativeSmoke).toContain('env:\n          PALAMEDES_UPDATE_CHECK: "0"');
    expect(nativeSmoke).toContain("execFileSync(bin, ['version']");
    const muslSmoke = musl.split("- name: Smoke-test musl native CLI package")[1];
    expect(muslSmoke).toMatch(/docker run --rm\s+-e PALAMEDES_UPDATE_CHECK=0\s+-v/u);
    expect(muslSmoke).toContain("execFileSync('./bin/pmds', ['version']");
  });

  it("runs enabled-process evidence separately on Linux in CI and release dry runs", async () => {
    const [ci, publish] = await Promise.all([
      readRepositoryFile(".github/workflows/ci.yml"),
      readRepositoryFile(".github/workflows/publish.yml"),
    ]);
    const ciProof = ci
      .split("- name: Verify enabled update-check opt-outs without network access")[1]
      .split("- name:")[0];
    expect(ciProof).toContain(
      `if: matrix.os == 'ubuntu-24.04' && matrix.toolchain == '${rustVersion}'`,
    );
    expect(ciProof).toContain("run: node ./scripts/check-enabled-update-check.mjs");
    const releaseValidation = job(publish, "validate-release", "publish-native");
    expect(releaseValidation).toContain("run: node ./scripts/check-enabled-update-check.mjs");
    expect(releaseValidation).not.toContain("PALAMEDES_UPDATE_ENDPOINT:");
    expect(releaseValidation.indexOf("cargo test --workspace --locked")).toBeLessThan(
      releaseValidation.indexOf("node ./scripts/check-enabled-update-check.mjs"),
    );
  });

  it("rejects uncontained enabled-process runs before any CLI execution", () => {
    const isolated = {
      parentNamespace: "net:[1]",
      namespace: "net:[2]",
      links: [{ ifname: "lo", flags: ["LOOPBACK"] }],
      ipv4Routes: [],
      ipv6Routes: [{ type: "unreachable" }],
    };
    expect(() => assertNetworkIsolation(isolated)).not.toThrow();
    for (const change of [
      { parentNamespace: undefined },
      { namespace: "net:[1]" },
      { links: [{ ifname: "eth0", flags: [] }] },
      { links: [...isolated.links, { ifname: "eth0", flags: [] }] },
      { links: [{ ifname: "lo", flags: ["LOOPBACK", "UP"] }] },
      { ipv4Routes: [{ dst: "default", gateway: "192.0.2.1" }] },
      { ipv6Routes: [{ dst: "default", dev: "eth0" }] },
    ]) {
      expect(() => assertNetworkIsolation({ ...isolated, ...change })).toThrow();
    }
  });

  it("keeps pure-JS container contracts in the full test gate", async () => {
    const [packageJson, ci] = await Promise.all([
      readRepositoryFile("package.json").then(JSON.parse),
      readRepositoryFile(".github/workflows/ci.yml"),
    ]);

    expect(packageJson.scripts.test).toContain("pnpm check:example-contracts");
    expect(packageJson.scripts.test).toContain("pnpm check:workflow-contracts");
    expect(packageJson.scripts["check:example-contracts"]).toContain(
      "scripts/container/start-plan.test.mjs",
    );
    expect(ci).toContain("run: pnpm test");
  });

  it("runs path-sensitive and published-consumer package tests on each non-Linux validation leg", async () => {
    const [ci, packageJson, nextPlugin, reactRouter, tanstack, vitePlugin] = await Promise.all([
      readRepositoryFile(".github/workflows/ci.yml"),
      readRepositoryFile("package.json").then(JSON.parse),
      readRepositoryFile("packages/next-plugin/package.json").then(JSON.parse),
      readRepositoryFile("packages/react-router/package.json").then(JSON.parse),
      readRepositoryFile("packages/tanstack/package.json").then(JSON.parse),
      readRepositoryFile("packages/vite-plugin/package.json").then(JSON.parse),
    ]);

    expect(ci).toContain("- os: macos-latest");
    expect(ci).toContain("- os: windows-2025");
    expect(ci).toContain("- name: Test path-sensitive packages");
    expect(ci).toContain("if: ${{ !matrix.full }}");
    expect(ci).toContain("run: pnpm test:platform");
    expect(packageJson.scripts["test:platform"]).toContain("--filter @palamedes/config");
    expect(packageJson.scripts["test:platform"]).toContain("--filter @palamedes/core-node");
    expect(packageJson.scripts["test:platform"]).toContain("--filter @palamedes/next-plugin");
    expect(packageJson.scripts["test:platform"]).toContain("--filter @palamedes/react-router");
    expect(packageJson.scripts["test:platform"]).toContain("--filter @palamedes/tanstack");
    expect(packageJson.scripts["test:platform"]).toContain("--filter @palamedes/vite-plugin");
    expect(nextPlugin.scripts.test).toBe("vitest run --globals");
    expect(reactRouter.scripts.test).toContain("scripts/package.test.mjs");
    expect(tanstack.scripts.test).toContain("scripts/package.test.mjs");
    expect(vitePlugin.scripts.test).toBe("vitest run --globals");
  });

  it("keeps the hot CI lane cancellable, least-privileged, and cached", async () => {
    const [ci, setupWorkspace] = await Promise.all([
      readRepositoryFile(".github/workflows/ci.yml"),
      readRepositoryFile(".github/actions/setup-workspace/action.yml"),
    ]);
    const validate = job(ci, "validate", "validate-rust");

    expect(ci).toContain("permissions:\n  contents: read");
    expect(ci).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
    expect(validate).toContain("uses: ./.github/actions/setup-workspace");
    expect(setupWorkspace).toContain("node-version:");
    expect(setupWorkspace).toContain("pnpm-cache:");
    expect(setupWorkspace).toContain("rust:");
    expect(setupWorkspace).toContain("rust-cache:");
    expect(setupWorkspace).toContain("registry-url:");
    expect(setupWorkspace).toContain("cache: pnpm");
    expect(setupWorkspace).toContain("uses: Swatinem/rust-cache@");
    expect(setupWorkspace.indexOf("cache: pnpm")).toBeLessThan(
      setupWorkspace.indexOf("uses: Swatinem/rust-cache@"),
    );
  });

  it("runs the Rust workspace tests on every shipped host platform", async () => {
    const [ci, toolchain] = await Promise.all([
      readRepositoryFile(".github/workflows/ci.yml"),
      readRepositoryFile("rust-toolchain.toml"),
    ]);
    const validateRust = job(ci, "validate-rust");

    for (const os of ["ubuntu-24.04", "windows-2025", "macos-latest"]) {
      expect(validateRust).toContain(`- os: ${os}`);
    }
    expect(validateRust).toContain("run: cargo test --workspace --locked");
    expect(validateRust).toContain("uses: ./.github/actions/setup-workspace");
    expect(validateRust).toContain("rust-toolchain: ${{ matrix.toolchain }}");
    expect(validateRust).toContain("rust-components: clippy, rustfmt");
    // Format and lint are platform-independent; only the tests fan out.
    expect(validateRust).toContain("if: ${{ matrix.lint }}");
    expect(toolchain).toContain(`channel = "${rustVersion}"`);
  });

  it("budgets both shipped native artifact families on the pinned toolchain", async () => {
    const [ci, binarySizeCheck] = await Promise.all([
      readRepositoryFile(".github/workflows/ci.yml"),
      readRepositoryFile("scripts/check-binary-size.mjs"),
    ]);
    const validateRust = job(ci, "validate-rust");

    expect(validateRust).toContain("- name: Check shipped binary sizes");
    expect(validateRust).toContain(`if: matrix.toolchain == '${rustVersion}'`);
    expect(validateRust).toContain("run: node ./scripts/check-binary-size.mjs");
    expect(binarySizeCheck).toContain('crate: "palamedes-cli"');
    expect(binarySizeCheck).toContain('crate: "palamedes-node"');
  });

  it("runs the Remix v3 full-stack browser proof on Linux", async () => {
    const ci = await readRepositoryFile(".github/workflows/ci.yml");
    const validate = job(ci, "validate", "validate-rust");

    expect(validate).toContain("- name: Verify Remix v3 full-stack browser path");
    expect(validate).toContain("if: matrix.os == 'ubuntu-24.04' && matrix.node == 24");
    expect(validate).toContain("run: pnpm verify:examples:browser -- --id remix-cookie");
    expect(validate).toContain("- name: Install Playwright Chromium");
    expect(validate.indexOf("run: pnpm exec playwright install --with-deps chromium")).toBeLessThan(
      validate.indexOf("run: pnpm verify:examples:browser -- --id remix-cookie"),
    );
  });

  it("preflights x64 and arm64 musl artifacts in CI with the release build and smoke commands", async () => {
    const [ci, publish, verifyMuslNative] = await Promise.all([
      readRepositoryFile(".github/workflows/ci.yml"),
      readRepositoryFile(".github/workflows/publish.yml"),
      readRepositoryFile(".github/actions/verify-musl-native/action.yml"),
    ]);
    const validateMuslNative = job(ci, "validate-musl-native", "validate-rust");
    const publishNative = job(publish, "publish-native", "publish-js");

    expect(ci).toContain("pull_request:");
    expect(ci).toContain("- main");
    expect(validateMuslNative).toContain("name: validate musl native (linux ${{ matrix.arch }})");
    expect(validateMuslNative).toContain("runs-on: ${{ matrix.runner }}");
    expect(validateMuslNative).toContain("permissions:\n      contents: read");
    expect(validateMuslNative).toContain("fail-fast: false");
    for (const [arch, runner, rustTarget] of [
      ["x64", "ubuntu-24.04", "x86_64-unknown-linux-musl"],
      ["arm64", "ubuntu-24.04-arm", "aarch64-unknown-linux-musl"],
    ]) {
      expect(validateMuslNative).toContain(`arch: ${arch}`);
      expect(validateMuslNative).toContain(`runner: ${runner}`);
      expect(validateMuslNative).toContain(`rust_target: ${rustTarget}`);
    }
    expect(validateMuslNative).toContain('rust-cache: "true"');
    expect(validateMuslNative).toContain('cargo-cache: "true"');
    expect(publishNative).not.toContain('cargo-cache: "true"');
    expect(validateMuslNative).toContain("run: pnpm install --frozen-lockfile");
    expect(validateMuslNative).not.toContain("publish-package-if-needed.mjs");
    for (const [matrixField, packageName] of [
      ["cli_package", "@palamedes/cli-linux-x64-musl"],
      ["node_package", "@palamedes/core-node-linux-x64-musl"],
      ["cli_package", "@palamedes/cli-linux-arm64-musl"],
      ["node_package", "@palamedes/core-node-linux-arm64-musl"],
    ]) {
      expect(validateMuslNative).toContain(`${matrixField}: "${packageName}"`);
      expect(publishNative).toContain(`package_name: "${packageName}"`);
    }
    expect(validateMuslNative.indexOf("@palamedes/cli-linux-x64-musl")).toBeLessThan(
      validateMuslNative.indexOf("@palamedes/core-node-linux-x64-musl"),
    );
    expect(validateMuslNative.indexOf("@palamedes/cli-linux-arm64-musl")).toBeLessThan(
      validateMuslNative.indexOf("@palamedes/core-node-linux-arm64-musl"),
    );
    expect(
      validateMuslNative.match(/uses: \.\/\.github\/actions\/verify-musl-native/gu),
    ).toHaveLength(2);
    expect(publishNative).toContain("uses: ./.github/actions/verify-musl-native");
    expect(verifyMuslNative).toContain('rustup target add "${{ inputs.rust_target }}"');
    expect(verifyMuslNative).toContain('pnpm --filter "${{ inputs.package_name }}" build');
    expect(verifyMuslNative).toContain("uses: actions/cache@");
    expect(verifyMuslNative).toContain("inputs.cargo-cache == 'true'");
    expect(verifyMuslNative).toContain("/usr/local/cargo/registry");
    expect(verifyMuslNative).toContain(`rust:${rustVersion}-alpine`);
    expect(verifyMuslNative).toContain("node:24-alpine");
    expect(verifyMuslNative).toContain("node ../core-node/scripts/build-native.mjs");
    expect(verifyMuslNative).toContain("execFileSync('./bin/pmds', ['version']");
  });

  it("runs the browser contract on pull requests and main changes", async () => {
    const workflow = await readRepositoryFile(".github/workflows/example-verification.yml");
    for (const step of [
      "Install Playwright Chromium",
      "Browser-test 25 browser-capable examples",
    ]) {
      const start = workflow.indexOf(`- name: ${step}`);
      expect(start).toBeGreaterThan(-1);
      const end = workflow.indexOf("\n      - name:", start + 1);
      const block = workflow.slice(start, end === -1 ? undefined : end);
      expect(block).toContain("if: github.event_name != 'workflow_dispatch' || inputs.run_browser");
    }
    expect(workflow).toContain('"scripts/proof-*.mjs"');
    expect(workflow).toContain('"scripts/verify-browser-artifacts.mjs"');
  });

  it("runs the example browser contract proofs on the exact release revision", async () => {
    const [publish, workflow, browserRunner] = await Promise.all([
      readRepositoryFile(".github/workflows/publish.yml"),
      readRepositoryFile(".github/workflows/example-verification.yml"),
      readRepositoryFile("scripts/verify-examples-browser.mjs"),
    ]);
    const verification = workflowJobs(publish).get("example-verification");
    expect(verification.needs).toEqual(["determine-release"]);
    expect(verification.if).toBe("needs.determine-release.outputs.should_publish == 'true'");
    expect(verification.text).toContain("uses: ./.github/workflows/example-verification.yml");
    expect(verification.text).toMatch(/with:\n {6}run_browser: true\n/u);
    expect(verification.text).not.toContain("continue-on-error");

    // Normal pull requests keep their path filter; the release call bypasses it.
    const triggers = workflow.slice(workflow.indexOf("on:\n"), workflow.indexOf("\npermissions:"));
    expect(triggers).toMatch(/^ {2}pull_request:\n {4}paths:\n/mu);
    const call = triggers.slice(
      triggers.indexOf("  workflow_call:"),
      triggers.indexOf("  workflow_dispatch:"),
    );
    expect(call).toMatch(/run_browser:\n(?: {8}.+\n)*? {8}default: true\n/u);
    expect(call).not.toContain("paths:");

    const steps = workflowJobs(workflow).get("verify").steps;
    const byName = Object.fromEntries(steps.map((step) => [step.name, step]));
    expect(byName["Check out repository"].text).toContain("ref: ${{ github.sha }}");
    expect(byName["Build workspace packages"].text).toContain("run: pnpm build");
    expect(byName["Smoke-test all 25 examples"].text).toContain("run: pnpm verify:examples:smoke");
    expect(byName["Install Playwright Chromium"].text).toContain(
      "run: pnpm exec playwright install --with-deps chromium",
    );
    const browser = byName["Browser-test 25 browser-capable examples"];
    expect(browser.text).toContain("run: pnpm verify:examples:browser");
    // A called workflow sees the caller's event, so a Publish dry run reaches
    // the browser steps through the workflow_call input default.
    expect(browser.if).toBe("github.event_name != 'workflow_dispatch' || inputs.run_browser");
    for (const step of steps) expect(step.text, step.name).not.toContain("continue-on-error");

    // The browser runner owns the framework delivery and failure proofs.
    for (const proof of [
      "proof-tanstack-catalog-errors.mjs",
      "proof-tanstack-development.mjs",
      "proof-vite-fragment-errors.mjs",
      "proof-vite-development.mjs",
      "proof-vite-html-delivery.mjs",
      "verify-solid-catalog-delivery.mjs",
      "proof-solid-development.mjs",
      "proof-waku-catalog-delivery.mjs",
      "proof-waku-development.mjs",
    ]) {
      expect(browserRunner).toContain(`runDeliveryProof("${proof}")`);
    }
  });

  it("caches Rust example builds and retries only scheduled browser verification", async () => {
    const [exampleVerification, browserConfig] = await Promise.all([
      readRepositoryFile(".github/workflows/example-verification.yml"),
      readRepositoryFile("vitest.examples.config.mjs"),
    ]);

    expect(exampleVerification).toContain("uses: ./.github/actions/setup-workspace");
    expect(exampleVerification).toContain(
      "PALAMEDES_BROWSER_RETRY: ${{ github.event_name == 'schedule' && '1' || '0' }}",
    );
    expect(browserConfig).toContain('retry: process.env.PALAMEDES_BROWSER_RETRY === "1" ? 1 : 0');
  });

  it("requires locked Rust workspace tests before any release publishing", async () => {
    const publish = await readRepositoryFile(".github/workflows/publish.yml");
    const validateRelease = job(publish, "validate-release", "publish-native");
    const publishNative = job(publish, "publish-native", "publish-js");
    const publishJs = job(publish, "publish-js", "__missing__");

    expect(validateRelease).toContain("ref: ${{ github.sha }}");
    expect(validateRelease).toContain("uses: ./.github/actions/setup-workspace");
    expect(validateRelease).toContain("run: pnpm test");
    expect(validateRelease).toContain("run: cargo test --workspace --locked");
    expect(publishNative).toMatch(/needs:\n(?:\s+- .+\n)*\s+- validate-release/m);
    expect(publishNative).toContain("ref: ${{ github.sha }}");
    expect(publishNative).toContain('rust-cache: "false"');
    expect(publishJs).toContain("ref: ${{ github.sha }}");
    expect(publishJs).toContain('rust-cache: "false"');
    expect(publishJs).toContain("- name: Materialize pinned Rust toolchain");
    expect(publishJs.indexOf("run: cargo --version")).toBeLessThan(
      publishJs.indexOf("- name: Build publishable packages"),
    );
  });

  it("prepares site test imports before Vitest without depending on a full site build", async () => {
    const publish = await readRepositoryFile(".github/workflows/publish.yml");
    const validateRelease = job(publish, "validate-release", "publish-native");
    const root = JSON.parse(await readRepositoryFile("package.json"));
    const site = JSON.parse(await readRepositoryFile("site/package.json"));
    expect(validateRelease).toContain("run: pnpm test");
    expect(root.scripts.test).toContain("pnpm --filter @palamedes/site test");
    expect(site.scripts.test.split(" && ").slice(0, 2)).toEqual([
      "node ./scripts/generate-benchmark-data.mjs",
      expect.stringMatching(/^vitest run /u),
    ]);
    expect(site.scripts.test).toContain("./scripts/generate-benchmark-data.test.mjs");
    const prebuild = await readRepositoryFile("site/scripts/prebuild-content.mjs");
    expect(prebuild).toContain(
      'import { writeBenchmarkData } from "./generate-benchmark-data.mjs"',
    );
    expect(prebuild).toContain("await writeBenchmarkData(repoRoot)");
  });

  it("stops a release before publishing anything when a package needs a first publish", async () => {
    const publish = await readRepositoryFile(".github/workflows/publish.yml");
    const validateRelease = job(publish, "validate-release", "publish-native");

    expect(validateRelease).toContain("run: node ./scripts/check-first-publish.mjs");
    // Before the build, so the check costs seconds rather than a full release gate.
    expect(validateRelease.indexOf("run: node ./scripts/check-first-publish.mjs")).toBeLessThan(
      validateRelease.indexOf("run: pnpm build"),
    );
  });

  it("surfaces first-publish setup in the full PR validation lane", async () => {
    const ci = await readRepositoryFile(".github/workflows/ci.yml");
    const validate = job(ci, "validate", "validate-rust");

    expect(validate).toContain("run: node ./scripts/check-first-publish.mjs --warn-only");
    expect(
      validate.indexOf("run: node ./scripts/check-first-publish.mjs --warn-only"),
    ).toBeLessThan(validate.indexOf("run: pnpm install --frozen-lockfile"));
  });

  it("verifies the published release set and reports a failed publish", async () => {
    const publish = await readRepositoryFile(".github/workflows/publish.yml");
    const publishJs = job(publish, "publish-js", "verify-release");
    const verifyRelease = job(publish, "verify-release", "retire-release-failure");
    const retireFailure = job(publish, "retire-release-failure", "notify-failure");
    const notifyFailure = job(publish, "notify-failure", "__missing__");

    expect(verifyRelease).toMatch(/needs:\n(?:\s+- .+\n)*\s+- publish-js/m);
    expect(verifyRelease).toContain("run: node ./scripts/check-published-versions.mjs");
    expect(verifyRelease).toMatch(/needs:\n(?:\s+- .+\n)*\s+- publish-cargo/m);
    expect(verifyRelease).toContain("run: node ./scripts/check-published-crates.mjs");
    expect(verifyRelease).toContain("timeout-minutes: 15");
    expect(verifyRelease).toContain("PALAMEDES_REGISTRY_RETRY_BUDGET_MS: 300000");
    expect(verifyRelease).toContain("PALAMEDES_REGISTRY_RETRY_MS: 15000");
    expect(publishJs).toContain("publish-package-if-needed.mjs --all-js");
    expect(publishJs).not.toContain("publish_package @palamedes/");
    expect(notifyFailure).toContain("issues: write");
    expect(notifyFailure).toContain("failure()");
    expect(notifyFailure).toContain("scripts/open-or-refresh-issue.mjs");
    expect(retireFailure).toContain("issues: write");
    expect(retireFailure).toContain("needs.verify-release.result == 'success'");
    expect(retireFailure).toContain('TITLE: "chore(release): publish workflow failed"');
    expect(retireFailure).toContain("scripts/open-or-refresh-issue.mjs");
    expect(retireFailure).toContain("--label type:bug");
    expect(retireFailure).toContain("--close-comment");
    expect(notifyFailure).toContain("--label type:bug");
    for (const jobName of [
      "determine-release",
      "preflight-cargo",
      "validate-release",
      "example-verification",
      "publish-native",
      "publish-js",
      "verify-release",
    ]) {
      expect(notifyFailure).toContain(`needs.${jobName}.result`);
    }
  });

  it("filters the umbrella package by directory so the workspace root cannot match", async () => {
    const [publish, rootPackageJson, umbrellaPackageJson] = await Promise.all([
      readRepositoryFile(".github/workflows/publish.yml"),
      readRepositoryFile("package.json").then(JSON.parse),
      readRepositoryFile("packages/palamedes/package.json").then(JSON.parse),
    ]);

    // The guard only matters while these two share a name; check-release-set.mjs
    // rejects any ambiguous name filter, and this pins the known collision.
    expect(rootPackageJson.name).toBe(umbrellaPackageJson.name);
    expect(publish).toContain("--filter ./packages/palamedes");
    expect(publish).not.toMatch(/--filter palamedes\s*$/m);
  });

  it("keeps the publish lanes least-privileged", async () => {
    const [publish, container] = await Promise.all([
      readRepositoryFile(".github/workflows/publish.yml"),
      readRepositoryFile(".github/workflows/publish-examples-container.yml"),
    ]);

    expect(publish).toContain("permissions:\n  contents: read");
    expect(container).toContain("permissions:\n  contents: read");
  });

  it("publishes main demo images independently while retaining the package release hold", async () => {
    const [publish, container] = await Promise.all([
      readRepositoryFile(".github/workflows/publish.yml"),
      readRepositoryFile(".github/workflows/publish-examples-container.yml"),
    ]);
    const detection = job(publish, "determine-release", "validate-release");
    expect(detection).toContain("run: node ./scripts/determine-release.mjs");
    expect(detection).toContain("ref: ${{ github.sha }}");
    expect(container).not.toContain("determine-release");
    expect(container).not.toContain("release-policy");
    expect(container).toContain("branches:\n      - main");
    expect(container).toContain(
      "if: github.ref == 'refs/heads/main' || (github.event_name == 'workflow_dispatch' && inputs.dry_run)",
    );
    expect(container).toContain("ref: ${{ github.sha }}");
    expect(container).toContain("load: true");
    expect(container).not.toContain("push: true");
    expect(container).toContain("docker exec examples-smoke node scripts/container/verify-all.mjs");
    const push = container.split("- name: Publish verified image tags")[1];
    expect(push).toContain("if: ${{ !inputs.dry_run && github.ref == 'refs/heads/main' }}");
    expect(container.indexOf("docker exec examples-smoke")).toBeLessThan(
      container.indexOf('docker push "$IMAGE:sha-$REVISION"'),
    );
    expect(container).toContain("Image: $digest");
  });

  it("requires an explicit main dispatch and verified digest before a Bunny mutation", async () => {
    const source = await readRepositoryFile(".github/workflows/deploy-examples.yml");
    expect(source).toContain("workflow_dispatch:");
    expect(source).not.toMatch(/^ {2}(push|pull_request|schedule):/mu);
    expect(source).toContain("default: verify-image");
    expect(source).toContain("if: github.ref == 'refs/heads/main'");
    expect(source).toContain("git merge-base --is-ancestor");
    expect(source).toContain("org.opencontainers.image.revision");
    const deploy = job(source, "deploy", "verify-hosts");
    expect(deploy).toContain("needs: verify-image");
    expect(deploy).toContain("if: inputs.operation == 'deploy'");
    expect(deploy).toContain("environment: bunny-demos");
    expect(deploy).toContain("BUNNYNET_API_KEY: ${{ secrets.BUNNY_API_KEY }}");
    expect(job(source, "verify-image", "deploy")).not.toContain("BUNNYNET_API_KEY");
    expect(job(source, "verify-hosts", "__missing__")).not.toContain("BUNNYNET_API_KEY");
  });

  it("lets the dependency audit exit code reach the tracking issue step", async () => {
    const dependencyAudit = await readRepositoryFile(".github/workflows/dependency-audit.yml");

    // `|| true` here would pin both step outcomes to success and make the issue
    // step below permanently unreachable.
    expect(dependencyAudit).not.toContain("pnpm audit --audit-level=high 2>&1 || true");
    expect(dependencyAudit).not.toContain("cargo audit 2>&1 || true");
    expect(dependencyAudit).toContain(
      "pnpm audit --audit-level=high >> audit-report.md 2>&1 || status=$?",
    );
    expect(dependencyAudit).toContain("cargo audit >> audit-report.md 2>&1 || status=$?");
    expect(dependencyAudit).toContain(
      "if: steps.npm-audit.outcome == 'failure' || steps.cargo-audit.outcome == 'failure'",
    );
    expect(dependencyAudit).toContain("scripts/open-or-refresh-issue.mjs");
  });

  it("offers every screenshot-capturable example in the capture dropdown", async () => {
    const capture = await readRepositoryFile(".github/workflows/capture-example-screenshots.yml");
    const options = Array.from(
      capture.slice(capture.indexOf("options:")).matchAll(/^ {10}- (\S+)$/gm),
      (match) => match[1],
    );

    // Workflow YAML cannot derive a choice list, so the matrix is the source of
    // truth and this is what notices when the two drift apart.
    expect(options).toEqual(["all", ...selectScreenshotExamples({}).map((example) => example.id)]);
  });

  it("uses the shared workspace preamble and gives expensive jobs a deadline", async () => {
    const workflowPaths = [
      ".github/workflows/ci.yml",
      ".github/workflows/dependency-audit.yml",
      ".github/workflows/example-verification.yml",
      ".github/workflows/deploy-site.yml",
      ".github/workflows/capture-example-screenshots.yml",
      ".github/workflows/publish.yml",
    ];
    const workflows = await Promise.all(workflowPaths.map(readRepositoryFile));

    for (const workflow of workflows) {
      expect(workflow).toContain("uses: ./.github/actions/setup-workspace");
    }

    const [capture, publish] = [workflows[4], workflows[5]];
    expect(capture).toContain("timeout-minutes: 90");
    expect(job(publish, "publish-native", "publish-js")).toContain("timeout-minutes: 45");
    expect(job(publish, "publish-js", "verify-release")).toContain("timeout-minutes: 45");
  });

  it("verifies the built site before the deploy job publishes it", async () => {
    const [deploySite, packageJson] = await Promise.all([
      readRepositoryFile(".github/workflows/deploy-site.yml"),
      readRepositoryFile("package.json").then(JSON.parse),
    ]);
    const build = job(deploySite, "build", "deploy");

    expect(packageJson.scripts["verify:site-routes"]).toBe("node ./scripts/verify-site-routes.mjs");
    expect(packageJson.scripts["verify:site-a11y"]).toBe("node ./scripts/verify-site-a11y.mjs");
    expect(build).toContain("run: pnpm verify:site-routes");
    expect(build).toContain("run: pnpm verify:site-a11y");
    // In the build job, so a dead route blocks the deploy rather than being
    // reported by the post-deploy curl checks after it is already live.
    expect(build.indexOf("run: pnpm build:site")).toBeLessThan(
      build.indexOf("run: pnpm verify:site-routes"),
    );
    expect(build.indexOf("run: pnpm build:site")).toBeLessThan(
      build.indexOf("run: pnpm verify:site-a11y"),
    );
    expect(build).toContain("run: pnpm exec playwright install --with-deps chromium");
  });

  it("pins every third-party action to a commit SHA with a version comment", async () => {
    const { checked, problems } = checkWorkflowPins(repositoryRoot);

    expect(problems).toEqual([]);
    expect(checked).toBeGreaterThan(0);

    // Local composite actions carry no reference to pin; everything else must
    // name a commit and say which release it is.
    expect(unpinnedActionReferences("      - uses: ./.github/actions/setup-workspace\n")).toEqual(
      [],
    );
    expect(unpinnedActionReferences("      - uses: actions/checkout@v7\n")).toHaveLength(1);

    const uncommented = `actions/checkout@${"a".repeat(40)}`;
    expect(unpinnedActionReferences(`      - uses: ${uncommented}\n`)).toEqual([
      `<memory>:1: ${uncommented} has no version comment`,
    ]);
  });

  it("runs the dependency policy and the pin check in CI", async () => {
    const [ci, packageJson] = await Promise.all([
      readRepositoryFile(".github/workflows/ci.yml"),
      readRepositoryFile("package.json").then(JSON.parse),
    ]);

    expect(packageJson.scripts["check:workflow-pins"]).toBe(
      "node ./scripts/check-workflow-pins.mjs",
    );
    expect(job(ci, "validate", "validate-rust")).toContain("run: pnpm check:workflow-pins");
    expect(job(ci, "validate-dependency-policy", "__missing__")).toContain(
      "uses: EmbarkStudios/cargo-deny-action@",
    );
  });

  it("keeps HTML live smoke probes independent of mutable page copy", async () => {
    const deploySite = await readRepositoryFile(".github/workflows/deploy-site.yml");
    const verify = job(deploySite, "verify", "__missing__");
    const htmlChecks = verify
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^check "\/(?:[^".]*)" 200(?: |$)/.test(line));

    expect(htmlChecks.length).toBeGreaterThan(0);
    expect(htmlChecks.every((line) => /^check "[^"]+" 200$/.test(line))).toBe(true);
  });

  it("maps every contributor-owned repository surface in CONTRIBUTING", async () => {
    const contributing = await readRepositoryFile("CONTRIBUTING.md");
    const repositoryPaths = [
      "packages/",
      "crates/",
      "examples/",
      "site/",
      "docs/",
      "adr/",
      "benchmarks/",
      "proof/",
      "tests/",
      "scripts/",
      ".github/workflows/",
    ];

    for (const repositoryPath of repositoryPaths) {
      expect((await stat(resolve(repositoryRoot, repositoryPath))).isDirectory()).toBe(true);
      expect(contributing).toContain(`\`${repositoryPath}\``);
    }
  });

  it("keeps the documented website workflow aligned with executable commands and paths", async () => {
    const [contributing, packageJson, sitePackageJson] = await Promise.all([
      readRepositoryFile("CONTRIBUTING.md"),
      readRepositoryFile("package.json").then(JSON.parse),
      readRepositoryFile("site/package.json").then(JSON.parse),
    ]);

    expect(packageJson.scripts["dev:site"]).toBe("pnpm --filter @palamedes/site dev");
    expect(packageJson.scripts["build:site"]).toBe("pnpm --filter @palamedes/site build");
    expect(packageJson.scripts["verify:site-routes"]).toBe("node ./scripts/verify-site-routes.mjs");
    expect(packageJson.scripts["verify:site-a11y"]).toBe("node ./scripts/verify-site-a11y.mjs");
    expect(packageJson.scripts["verify:site-docs-dev"]).toBe(
      "node ./site/scripts/verify-docs-development.mjs",
    );
    expect(sitePackageJson.scripts.dev).toBe(
      "node ./scripts/prebuild-content.mjs && react-router dev --port 4100",
    );

    const buildSteps = [
      "node ../scripts/verify-site-bench-data.mjs",
      "node ../scripts/check-example-matrix.mjs",
      "node ../scripts/verify-site-editorial-rails.mjs",
      "node ../scripts/verify-site-streamline-assets.mjs",
      "node ./scripts/generate-og-images.mjs --check",
      "node ./scripts/prebuild-content.mjs",
      "react-router build",
      "node ../scripts/copy-llms-to-site.mjs",
    ];
    let previousBuildStep = -1;
    for (const buildStep of buildSteps) {
      const index = sitePackageJson.scripts.build.indexOf(buildStep);
      expect(index).toBeGreaterThan(previousBuildStep);
      previousBuildStep = index;
    }

    const documentedCommands = [
      "pnpm dev:site",
      "pnpm build:site",
      "pnpm verify:site-routes",
      "pnpm verify:site-a11y",
      "pnpm verify:site-docs-dev",
    ];
    let previousCommand = -1;
    for (const command of documentedCommands) {
      const index = contributing.indexOf(command);
      expect(index).toBeGreaterThan(previousCommand);
      previousCommand = index;
    }

    for (const documentedPath of [
      "docs/",
      "adr/",
      "site/content/blog/",
      "site/app/routes.ts",
      "site/app/routes/docs/",
      "site/app/routes/decisions/",
      "site/app/routes/blog/",
      "site/app/routes/api-reference/",
      "site/app/data/generated/",
    ]) {
      expect(contributing).toContain(`\`${documentedPath}\``);
    }
    expect(contributing).toContain("http://localhost:4100");
    expect(contributing).toContain("pnpm exec playwright install chromium");
  });

  it("checks cold-cache docs navigation on the full pull-request job", async () => {
    const [ci, packageJson] = await Promise.all([
      readRepositoryFile(".github/workflows/ci.yml"),
      readRepositoryFile("package.json").then(JSON.parse),
    ]);
    const validate = job(ci, "validate", "validate-rust");

    expect(packageJson.scripts["verify:site-docs-dev"]).toBe(
      "node ./site/scripts/verify-docs-development.mjs",
    );
    expect(validate).toContain("run: pnpm verify:site-docs-dev");
    expect(validate.indexOf("run: pnpm build:site")).toBeLessThan(
      validate.indexOf("run: pnpm verify:site-docs-dev"),
    );
  });

  it("gates both coverage flows on one threshold source", async () => {
    const [ci, vitestConfig, readme, packageJson] = await Promise.all([
      readRepositoryFile(".github/workflows/ci.yml"),
      readRepositoryFile("vitest.coverage.config.mts"),
      readRepositoryFile("README.md"),
      readRepositoryFile("package.json").then(JSON.parse),
    ]);
    const validate = job(ci, "validate", "validate-rust");
    const rust = job(ci, "validate-rust", "validate-dependency-policy");

    // Neither floor is ever restated: the vitest config reads the JavaScript
    // one, the workflow asks the script for the Rust one.
    expect(packageJson.scripts["test:coverage"]).toBe(
      "vitest run --config vitest.coverage.config.mts --coverage",
    );
    expect(vitestConfig).toContain("lines: COVERAGE_GATES.javascript.threshold");
    expect(validate).toContain("run: pnpm test:coverage");
    expect(rust).toContain(
      'cargo llvm-cov report --fail-under-lines "$(node ./scripts/coverage-gate.mjs rust --threshold)"',
    );

    // Both flows report their number into the run summary, including on the
    // run that just failed the gate.
    expect(validate).toContain("run: node ./scripts/coverage-gate.mjs javascript");
    expect(rust).toContain("run: node ./scripts/coverage-gate.mjs rust\n");

    // Coverage is enforced here, not reported to an external service.
    expect(ci.toLowerCase()).not.toContain("codecov");

    const badge = readme.match(/^\[!\[(Coverage gate[^\]]*)\]\((\S+)\)\]\((\S+)\)$/mu);
    expect(badge).not.toBeNull();
    for (const threshold of [COVERAGE_GATES.javascript.threshold, COVERAGE_GATES.rust.threshold]) {
      expect(badge[1]).toContain(`≥ ${threshold}%`);
      expect(decodeURIComponent(badge[2])).toContain(`≥ ${threshold}%`);
    }
    expect(badge[3]).toBe(
      "https://github.com/sebastian-software/palamedes/blob/main/.github/workflows/ci.yml",
    );
  });
});
