import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  checkWorkflowPins,
  unpinnedActionReferences,
  unpinnedContainerfileReferences,
  unpinnedWorkflowContainerReferences,
} from "./check-workflow-pins.mjs";
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
  it("keeps one stable CI gate over every CI job, including all matrix legs", async () => {
    const jobs = workflowJobs(await readRepositoryFile(".github/workflows/ci.yml"));
    const gate = jobs.get("ci-gate");
    expect(gate).toBeDefined();
    expect(gate.text).toContain("name: CI gate\n");
    expect(gate.if).toBe("${{ always() }}");
    expect(gate.needs.toSorted()).toEqual(
      [...jobs.keys()].filter((name) => name !== "ci-gate").sort(),
    );
    expect(gate.text).toContain("CI_NEEDS: ${{ toJSON(needs) }}");
    expect(gate.text).not.toContain("continue-on-error:");
    expect(gate.steps).toHaveLength(1);
    expect(gate.steps[0].if).toBe("");
  });

  it("executes the CI gate and blocks failed, cancelled, skipped, or missing results", async () => {
    const jobs = workflowJobs(await readRepositoryFile(".github/workflows/ci.yml"));
    const gate = jobs.get("ci-gate");
    const script = gate.text.match(/^ {10}node <<'NODE'\n(?<script>[\s\S]*?)^ {10}NODE$/mu)?.groups
      ?.script;
    expect(script).toBeDefined();
    const successful = Object.fromEntries(gate.needs.map((name) => [name, { result: "success" }]));
    const run = (needs) =>
      spawnSync(process.execPath, ["-e", script], {
        encoding: "utf8",
        env: { ...process.env, CI_NEEDS: JSON.stringify(needs) },
      });

    expect(run(successful).status).toBe(0);
    for (const name of gate.needs) {
      for (const result of ["failure", "cancelled", "skipped", undefined]) {
        const output = run({ ...successful, [name]: { result } });
        expect(output.status, `${name}: ${result}`).toBe(1);
        expect(output.stderr).toContain(`${name}: ${result}`);
      }
    }
    expect(run({}).status).toBe(1);
  });

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
    const policyStep = workflow
      .split("- name: Check isolated fuzz dependency policy")[1]
      ?.split("- name: Set up fuzz toolchain")[0];
    expect(policyStep).toContain('arguments: "--locked"');
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
    expect(workflow).toContain("actions: read");
    expect(compare).toContain("runner-class.mjs validate");
    expect(compare.indexOf("runner-class.mjs validate")).toBeLessThan(
      compare.indexOf("Read workspace Rust version"),
    );
    expect(compare).toContain("runner-class.mjs wait");
    expect(compare).toContain("GH_TOKEN: ${{ github.token }}");
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

    const nodeVersions = [...validate.matchAll(/^\s+node: (\d+)$/gmu)].map((match) =>
      Number(match[1]),
    );
    expect([...new Set(nodeVersions)].sort((a, b) => a - b)).toEqual([24, 26]);
    expect(ci).toContain("permissions:\n  contents: read");
    expect(ci).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
    expect(validate).toContain("uses: ./.github/actions/setup-workspace");
    expect(setupWorkspace).toContain("node-version:");
    expect(setupWorkspace).toContain("pnpm-cache:");
    expect(setupWorkspace).toContain("rust:");
    expect(setupWorkspace).toContain("rust-cache:");
    expect(setupWorkspace).toContain("registry-url:");
    expect(setupWorkspace).toContain("if ! command -v corepack >/dev/null 2>&1; then");
    expect(setupWorkspace).toContain("npm install --global corepack@0.36.0");
    expect(setupWorkspace.indexOf("command -v corepack")).toBeLessThan(
      setupWorkspace.indexOf("npm install --global corepack@0.36.0"),
    );
    expect(setupWorkspace.indexOf("npm install --global corepack@0.36.0")).toBeLessThan(
      setupWorkspace.indexOf("corepack enable"),
    );
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
    expect(verifyMuslNative).toContain("sysroot=\\$(cd / && rustc --print sysroot)");
    expect(verifyMuslNative).toContain(
      'test \\"\\$(command -v cargo)\\" = \\"\\$sysroot/bin/cargo\\"',
    );
    expect(verifyMuslNative).toContain(
      'test \\"\\$(command -v rustc)\\" = \\"\\$sysroot/bin/rustc\\"',
    );
    expect(verifyMuslNative).toContain("node ../core-node/scripts/build-native.mjs");
    expect(verifyMuslNative).toContain("execFileSync('./bin/pmds', ['version']");
  });

  it("isolates musl compilation caches by environment and refreshes them for source changes", async () => {
    const action = await readRepositoryFile(".github/actions/verify-musl-native/action.yml");
    const cache = action
      .split("- name: Restore musl container Cargo cache")[1]
      .split("\n    - name:")[0];
    const keyPrefix =
      "palamedes-musl-cargo-v2-${{ runner.os }}-${{ runner.arch }}-${{ inputs.rust_target }}-${{ steps.musl-toolchain.outputs.image }}-${{ hashFiles('Cargo.lock') }}-";
    expect(cache).toContain(`key: ${keyPrefix}\${{ hashFiles(`);
    expect(cache).toContain(`restore-keys: |\n          ${keyPrefix}\n`);
    for (const input of [
      "Cargo.toml",
      "crates/**",
      ".cargo/**",
      "packages/core-node/scripts/**",
      "scripts/build-native-lib.mjs",
    ]) {
      expect(cache).toContain(`'${input}'`);
    }
    expect(action).toContain('docker pull "$image"');
    expect(action).toContain("docker image inspect --format='{{.Id}}' \"$image\"");
  });

  it("mounts restored musl compilation output only for cache-enabled builds on either architecture", async () => {
    const action = await readRepositoryFile(".github/actions/verify-musl-native/action.yml");
    const step = action
      .split("- name: Build musl core-node addon (native musl toolchain)")[1]
      .split("\n    - name:")[0];
    const script = step.split("run: |\n")[1].replace(/^ {8}/gmu, "");
    const runnerTemp = await mkdtemp(join(tmpdir(), "palamedes musl cache-"));
    try {
      for (const target of ["x86_64-unknown-linux-musl", "aarch64-unknown-linux-musl"]) {
        for (const enabled of ["true", "false"]) {
          const rendered = script
            .replaceAll("${{ inputs.cargo-cache }}", enabled)
            .replaceAll("${{ inputs.rust_target }}", target)
            .replaceAll("${{ inputs.package_dir }}", "packages/core-node-test-musl")
            .replaceAll("${{ steps.musl-toolchain.outputs.image }}", "sha256:test-image");
          // Exercise Bash quoting and argument expansion without requiring a Docker daemon.
          const result = spawnSync(
            "bash",
            ["-e", "-c", `docker() { printf '%s\\0' "$@"; }\n${rendered}`],
            {
              cwd: repositoryRoot,
              env: { ...process.env, RUNNER_TEMP: runnerTemp },
              encoding: "utf8",
            },
          );
          expect(result.stderr).toBe("");
          expect(result.status).toBe(0);
          const args = result.stdout.split("\0").filter(Boolean);
          expect(args).toContain("sha256:test-image");
          expect(
            args.includes(`${runnerTemp}/palamedes-musl-cargo/${target}/target:/cache/target`),
          ).toBe(enabled === "true");
          expect(args.includes("CARGO_TARGET_DIR=/cache/target")).toBe(enabled === "true");
          expect(args).toContain(`${repositoryRoot}:/workspace`);
        }
      }
    } finally {
      await rm(runnerTemp, { recursive: true, force: true });
    }
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
      "publish-cargo",
      "verify-release",
    ]) {
      expect(notifyFailure).toContain(`needs.${jobName}.result`);
    }
  });

  it("reports a cancelled release job as well as a failed one", async () => {
    const jobs = workflowJobs(await readRepositoryFile(".github/workflows/publish.yml"));
    const notify = jobs.get("notify-failure");
    const releaseJobs = [...jobs.keys()].filter(
      (name) => !["notify-failure", "retire-release-failure"].includes(name),
    );

    // failure() is false when a job was cancelled, so the notifier must run
    // under always() and inspect every needed job's result itself.
    expect(notify.needs.sort()).toEqual(releaseJobs.sort());
    expect(notify.if).toMatch(/^\$\{\{ always\(\) && /u);
    expect(notify.if).toContain(
      "(contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled'))",
    );
    expect(notify.if).toContain("(github.event_name != 'workflow_dispatch' || !inputs.dry_run)");
    expect(notify.if).toContain(
      "(needs.determine-release.result == 'failure' || needs.determine-release.outputs.should_publish == 'true')",
    );
  });

  it("serializes only release uploads, so an ordinary main push cannot cancel a pending release", async () => {
    const publish = await readRepositoryFile(".github/workflows/publish.yml");
    const jobs = workflowJobs(publish);

    // A workflow-level group admits every main push; the next push then
    // replaces a pending release run, and GitHub cancels it.
    expect(publish.slice(0, publish.indexOf("\njobs:\n"))).not.toMatch(/^concurrency:/mu);

    const releaseOnly = "needs.determine-release.outputs.should_publish == 'true'";
    const groups = {
      "publish-native": [
        "format('publish-native-{0}-{1}', github.ref, matrix.package_name)",
        "format('publish-native-{0}-{1}', github.run_id, matrix.package_name)",
      ],
      "publish-cargo": [
        "format('publish-cargo-{0}', github.ref)",
        "format('publish-cargo-{0}', github.run_id)",
      ],
      "publish-js": [
        "format('publish-js-{0}', github.ref)",
        "format('publish-js-{0}', github.run_id)",
      ],
    };
    for (const [name, releaseJob] of jobs) {
      const concurrency =
        /^ {4}concurrency:\n {6}group: (.+)\n {6}cancel-in-progress: (.+)$/mu.exec(releaseJob.text);
      if (!groups[name]) {
        expect(releaseJob.text, name).not.toMatch(/^ {4}concurrency:/mu);
        continue;
      }
      const [releaseGroup, runGroup] = groups[name];
      expect(releaseJob.if, name).toContain(releaseOnly);
      expect(concurrency?.[1], name).toBe(
        `\${{ ${releaseOnly} && ${releaseGroup} || ${runGroup} }}`,
      );
      // Waiting, never cancelling: a cancelled upload leaves a partial release.
      expect(concurrency?.[2], name).toBe("false");
    }
  });

  it("fails closed on unreadable release tags only in the Publish release check", async () => {
    const [publish, ci] = await Promise.all([
      readRepositoryFile(".github/workflows/publish.yml"),
      readRepositoryFile(".github/workflows/ci.yml"),
    ]);
    const releaseSetStep = (workflow) =>
      [...workflowJobs(workflow).values()]
        .flatMap((releaseJob) => releaseJob.steps)
        .filter((step) => step.text.includes("run: pnpm check:release-set"));

    const [publishStep, ...otherPublishSteps] = releaseSetStep(publish);
    expect(otherPublishSteps).toEqual([]);
    expect(publishStep.text).toContain("PALAMEDES_RELEASE_TAGS: required");
    // PR and main CI only warn, so a network flake cannot fail unrelated work.
    for (const step of releaseSetStep(ci)) {
      expect(step.text).not.toContain("PALAMEDES_RELEASE_TAGS");
    }
    expect(releaseSetStep(ci).length).toBeGreaterThan(0);
  });

  it("holds crates.io until every native package has shipped", async () => {
    const jobs = workflowJobs(await readRepositoryFile(".github/workflows/publish.yml"));

    // A native build failure must stop both registries: npm JavaScript
    // already waits for it, so crates.io does too.
    for (const name of ["publish-cargo", "publish-js"]) {
      expect(jobs.get(name).needs, name).toContain("publish-native");
    }
    expect(transitiveNeeds(jobs, "publish-native").has("publish-cargo")).toBe(false);
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

  it("lets the dependency audit exit code reach the downstream tracking issue job", async () => {
    const dependencyAudit = await readRepositoryFile(".github/workflows/dependency-audit.yml");
    const header = dependencyAudit.slice(0, dependencyAudit.indexOf("\njobs:\n"));
    const jobs = workflowJobs(dependencyAudit);
    const audit = jobs.get("audit");
    const report = jobs.get("report-issue");

    // Workflow defaults to read-only; only the downstream reporting job holds `issues: write`.
    expect(header).toContain("permissions:\n  contents: read");
    expect(header).not.toMatch(/^ {2}issues:/mu);
    expect(audit.text).not.toMatch(/^ {6}issues:/mu);
    expect(audit.text).toContain("npm_audit_outcome: ${{ steps.npm-audit.outcome }}");
    expect(audit.text).toContain("cargo_audit_outcome: ${{ steps.cargo-audit.outcome }}");

    // `|| true` here would pin both step outcomes to success and make the issue
    // job below permanently unreachable.
    expect(audit.text).not.toContain("pnpm audit --audit-level=high 2>&1 || true");
    expect(audit.text).not.toContain("cargo audit 2>&1 || true");
    expect(audit.text).toContain(
      "pnpm audit --audit-level=high >> audit-report.md 2>&1 || status=$?",
    );
    expect(audit.text).toContain("cargo audit >> audit-report.md 2>&1 || status=$?");

    expect(report).toBeDefined();
    expect(report.needs).toEqual(["audit"]);
    expect(report.text).toMatch(/permissions:\n {6}contents: read\n {6}issues: write/u);
    expect(report.text).toContain("needs.audit.outputs.npm_audit_outcome == 'failure'");
    expect(report.text).toContain("needs.audit.outputs.cargo_audit_outcome == 'failure'");
    expect(report.text).toContain("scripts/open-or-refresh-issue.mjs");
  });

  it("runs independent asset and permutation canary contracts with browser coverage and isolated issue reporting", async () => {
    const [canary, example] = await Promise.all([
      readRepositoryFile(".github/workflows/next-canary.yml"),
      readRepositoryFile("examples/nextjs-route/package.json"),
    ]);
    const header = canary.slice(0, canary.indexOf("\njobs:\n"));
    const jobs = workflowJobs(canary);
    const assets = jobs.get("contract-assets");
    const permutations = jobs.get("contract-permutations");
    const report = jobs.get("report-issues");

    // Canary changes independently of pull requests, so it must not gate them.
    expect(canary).toMatch(/^ {2}schedule:$/mu);
    expect(canary).toContain("workflow_dispatch:");
    expect(canary).not.toMatch(/^ {2}(push|pull_request):/mu);
    expect(header).toContain("permissions:\n  contents: read");
    expect(header).not.toMatch(/^ {2}issues:/mu);

    for (const [delivery, label, contractJob] of [
      ["assets", "asset", assets],
      ["permutations", "permutation", permutations],
    ]) {
      expect(contractJob, delivery).toBeDefined();
      expect(contractJob.needs).toEqual([]);
      expect(contractJob.text).not.toMatch(/^ {6}issues:/mu);
      expect(contractJob.text).toContain(`client catalog ${label} contract`);
      expect(contractJob.text).toContain(
        'pnpm --filter @palamedes/example-nextjs-route --filter @palamedes/next-plugin add "next@$version"',
      );
      expect(contractJob.text).toContain(
        `run: pnpm --dir examples/nextjs-route build:catalog-${delivery}`,
      );
      expect(contractJob.text).toContain("contract_outcome: ${{ steps.contract.outcome }}");
      expect(contractJob.text).toContain("next_version: ${{ steps.next.outputs.version }}");
      expect(JSON.parse(example).scripts[`build:catalog-${delivery}`]).toContain(
        `check-next-client-catalog-${delivery}.mjs`,
      );
    }
    expect(assets.text).not.toContain("playwright install");
    expect(permutations.text).toContain("pnpm exec playwright install --with-deps chromium");

    expect(report).toBeDefined();
    expect(report.needs.toSorted()).toEqual(["contract-assets", "contract-permutations"]);
    expect(report.if).toContain("always()");
    expect(report.if).toContain("github.event_name == 'schedule'");
    expect(report.text).toMatch(/permissions:\n {6}contents: read\n {6}issues: write/u);
    expect(report.text).toContain("ASSETS_JOB_RESULT: ${{ needs.contract-assets.result }}");
    expect(report.text).toContain(
      "PERMUTATIONS_JOB_RESULT: ${{ needs.contract-permutations.result }}",
    );
    expect(report.text).toContain("scripts/open-or-refresh-issue.mjs");
    expect(report.text).toContain("const failures = [];");
    expect(report.text).toContain("if (failures.length > 0)");
    expect(report.text).toContain("Unexpected upstream state");
  });

  it("scopes GitHub Pages write permissions strictly to the site deploy job", async () => {
    const deploySite = await readRepositoryFile(".github/workflows/deploy-site.yml");
    const header = deploySite.slice(0, deploySite.indexOf("\njobs:\n"));
    const jobs = workflowJobs(deploySite);
    const build = jobs.get("build");
    const deploy = jobs.get("deploy");
    const verify = jobs.get("verify");

    expect(header).toContain("permissions:\n  contents: read");
    expect(header).not.toMatch(/^ {2}(?:pages|id-token):/mu);
    expect(build.text).not.toMatch(/^ {6}(?:pages|id-token):|actions\/configure-pages/mu);
    expect(deploy.text).toMatch(/permissions:\n {6}pages: write\n {6}id-token: write/u);
    expect(deploy.text).toContain("actions/configure-pages@");
    expect(deploy.text).toContain("actions/deploy-pages@");
    expect(verify.text).toContain("permissions: {}");
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
      ".github/workflows/next-canary.yml",
    ];
    const workflows = await Promise.all(workflowPaths.map(readRepositoryFile));

    for (const workflow of workflows) {
      expect(workflow).toContain("uses: ./.github/actions/setup-workspace");
    }

    const [capture, publish] = [workflows[4], workflows[5]];
    expect(capture).toContain("timeout-minutes: 90");
    expect(job(publish, "publish-native", "publish-js")).toContain("timeout-minutes: 45");
    expect(job(publish, "publish-js", "verify-release")).toContain("timeout-minutes: 45");
    expect(workflows[6]).toContain("timeout-minutes: 45");
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

  it("deploys when only a site verification input changes", async () => {
    const [deploySite, ci, packageJson] = await Promise.all([
      readRepositoryFile(".github/workflows/deploy-site.yml"),
      readRepositoryFile(".github/workflows/ci.yml"),
      readRepositoryFile("package.json").then(JSON.parse),
    ]);
    // Pull-request CI does not run the full route crawl, so a change to its
    // inputs alone must still reach the Deploy Site workflow.
    for (const path of [
      '"package.json"',
      '"site/**"',
      '"scripts/*site*.mjs"',
      '"scripts/example-matrix*.mjs"',
    ]) {
      expect(deploySite).toContain(`      - ${path}\n`);
    }

    // The static outline check does run in pull requests, after the build.
    expect(packageJson.scripts["verify:site-outlines"]).toBe(
      "node ./site/scripts/verify-doc-outlines.mjs",
    );
    const validate = job(ci, "validate", "validate-rust");
    expect(validate.indexOf("run: pnpm build:site")).toBeGreaterThan(-1);
    expect(validate.indexOf("run: pnpm build:site")).toBeLessThan(
      validate.indexOf("run: pnpm verify:site-outlines"),
    );
  });

  it("pins every third-party action and container image to an immutable digest", async () => {
    const { checked, containerFilesChecked, problems } = checkWorkflowPins(repositoryRoot);

    expect(problems).toEqual([]);
    expect(checked).toBeGreaterThan(0);
    expect(containerFilesChecked).toBeGreaterThan(0);

    // Local composite actions carry no reference to pin; everything else must
    // name a commit and say which release it is.
    expect(unpinnedActionReferences("      - uses: ./.github/actions/setup-workspace\n")).toEqual(
      [],
    );
    expect(unpinnedActionReferences("      - uses: actions/checkout@v7\n")).toHaveLength(1);
    expect(unpinnedActionReferences("      - uses: docker://alpine:3.20\n")).toHaveLength(1);
    expect(unpinnedActionReferences("      - { uses: docker://alpine:3.20 }\n")).toEqual([
      "<memory>:1: docker://alpine:3.20 is not pinned to a sha256 digest",
    ]);
    const digest = `sha256:${"a".repeat(64)}`;
    expect(unpinnedActionReferences(`      - uses: docker://alpine:3.20@${digest}\n`)).toEqual([]);
    expect(unpinnedActionReferences(`      - uses: "docker://alpine:3.20@${digest}"\n`)).toEqual(
      [],
    );
    expect(
      unpinnedActionReferences(`      - { uses: "docker://alpine:3.20@${digest}" }\n`),
    ).toEqual([]);

    const uncommented = `actions/checkout@${"a".repeat(40)}`;
    expect(unpinnedActionReferences(`      - uses: ${uncommented}\n`)).toEqual([
      `<memory>:1: ${uncommented} has no version comment`,
    ]);

    // Workflow and composite-action container references must carry a sha256 digest.
    expect(unpinnedWorkflowContainerReferences("    container: node:24\n")).toEqual([
      "<memory>:1: node:24 is not pinned to a sha256 digest",
    ]);
    expect(unpinnedWorkflowContainerReferences(`    container: node:24@${digest}\n`)).toEqual([]);
    expect(
      unpinnedWorkflowContainerReferences(`    container: { image: node:24@${digest} }\n`),
    ).toEqual([]);
    expect(unpinnedWorkflowContainerReferences("    container: { image: node:24 }\n")).toEqual([
      "<memory>:1: node:24 is not pinned to a sha256 digest",
    ]);
    expect(unpinnedWorkflowContainerReferences("    image: node:24-alpine\n")).toHaveLength(1);
    expect(unpinnedWorkflowContainerReferences(`    image: node:24-alpine@${digest}\n`)).toEqual(
      [],
    );
    expect(
      unpinnedWorkflowContainerReferences("runs:\n  using: docker\n  image: Dockerfile\n"),
    ).toEqual([]);
    expect(
      unpinnedWorkflowContainerReferences(
        "runs:\n  using: docker\n  image: docker://alpine:3.20\n",
      ),
    ).toEqual(["<memory>:3: docker://alpine:3.20 is not pinned to a sha256 digest"]);
    expect(
      unpinnedWorkflowContainerReferences(
        '      - name: Quoted\n        run: "docker pull node:24"\n',
      ),
    ).toEqual(["<memory>:2: node:24 is not pinned to a sha256 digest"]);
    expect(
      unpinnedWorkflowContainerReferences(
        'env:\n  IMAGE: node:24\njobs:\n  test:\n    steps:\n      - run: docker pull "$IMAGE"\n',
      ),
    ).toEqual(["<memory>:2: node:24 is not pinned to a sha256 digest"]);
    expect(
      unpinnedWorkflowContainerReferences(
        `env:\n  IMAGE: node:24\njobs:\n  test:\n    env:\n      IMAGE: node:24@${digest}\n    steps:\n      - run: docker pull "$IMAGE"\n`,
      ),
    ).toEqual([]);
    expect(
      unpinnedWorkflowContainerReferences(
        '      - name: Pull\n        run: |\n          image=rust:1.96-alpine # pin rust\n          docker pull "$image"\n',
      ),
    ).toEqual(["<memory>:3: rust:1.96-alpine is not pinned to a sha256 digest"]);
    expect(
      unpinnedWorkflowContainerReferences(
        `      - name: Pull\n        run: |\n          image=rust:1.96-alpine@${digest} # pin rust\n          docker pull "$image"\n`,
      ),
    ).toEqual([]);
    expect(
      unpinnedWorkflowContainerReferences(
        "---\nname: Doc Marker\non: workflow_dispatch\njobs:\n  test:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: |\n          if ! docker pull node:24; then exit 1; fi\n          until docker pull alpine:3.20; do sleep 1; done\n",
      ),
    ).toEqual([
      "<memory>:9: node:24 is not pinned to a sha256 digest",
      "<memory>:10: alpine:3.20 is not pinned to a sha256 digest",
    ]);
    expect(
      unpinnedWorkflowContainerReferences(
        `---\nname: Doc Marker Pinned\non: workflow_dispatch\njobs:\n  test:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: |\n          if ! docker pull node:24@${digest}; then exit 1; fi\n`,
      ),
    ).toEqual([]);
    // YAML anchors/aliases/merge keys and Docker management commands (`image pull`, `container run`).
    const anchoredPinned = [
      "jobs:",
      "  first:",
      "    runs-on: ubuntu-24.04",
      "    env: &shared_env",
      `      IMAGE: node:24@${digest}`,
      "    steps:",
      `      - uses: actions/checkout@${"a".repeat(40)} # v7`,
      '      - run: docker image pull "$IMAGE"',
      "  second:",
      "    runs-on: ubuntu-24.04",
      "    env: *shared_env",
      "    steps:",
      '      - run: docker container run --rm "$IMAGE" node -v',
      "",
    ].join("\n");
    expect(unpinnedActionReferences(anchoredPinned)).toEqual([]);
    expect(unpinnedWorkflowContainerReferences(anchoredPinned)).toEqual([]);
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "jobs:",
          "  first:",
          "    runs-on: ubuntu-24.04",
          "    env: &shared_env",
          "      IMAGE: node:24",
          "    steps:",
          '      - run: docker image pull "$IMAGE"',
          "  second:",
          "    runs-on: ubuntu-24.04",
          "    env:",
          "      <<: *shared_env",
          "    steps:",
          '      - run: docker container run --rm "$IMAGE" node -v',
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "<memory>:5: node:24 is not pinned to a sha256 digest",
      "<memory>:5: node:24 is not pinned to a sha256 digest",
    ]);
    // Actions `${{ env.* }}` expressions resolve against scoped static env mappings.
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "env:",
          "  IMAGE: node:24",
          "jobs:",
          "  test:",
          "    container: ${{ env.IMAGE }}",
          "    steps:",
          "      - run: docker pull ${{ env.IMAGE }}",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "<memory>:2: node:24 is not pinned to a sha256 digest",
      "<memory>:2: node:24 is not pinned to a sha256 digest",
    ]);
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "env:",
          `  IMAGE: node:24@${digest}`,
          "jobs:",
          "  test:",
          "    container: ${{ env.IMAGE }}",
          "    steps:",
          "      - run: docker pull ${{ env.IMAGE }}",
          "",
        ].join("\n"),
      ),
    ).toEqual([]);
    // YAML document markers and Docker examples inside heredocs must not trigger false positives,
    // while Bash here-strings (`<<<`) must not hide subsequent Docker commands.
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "---",
          "jobs:",
          "  docs:",
          "    runs-on: ubuntu-24.04",
          "    steps:",
          '      - name: "Multi-line quoted',
          '          step title"',
          "        run: |",
          "          cat <<'YAML' > manifest.yaml",
          "          ---",
          "          kind: Demo",
          "          ...",
          "          YAML",
          "          cat <<'EOF' >> \"$GITHUB_STEP_SUMMARY\"",
          "          docker pull node:24",
          "          EOF",
          '          grep -qF ok <<<"ok"',
          `          docker pull node:24@${digest}`,
          "",
        ].join("\n"),
      ),
    ).toEqual([]);
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "jobs:",
          "  herestring:",
          "    runs-on: ubuntu-24.04",
          "    steps:",
          "      - run: |",
          '          grep -qF ok <<<"ok"',
          "          docker pull node:24",
          "",
        ].join("\n"),
      ),
    ).toEqual(["<memory>:7: node:24 is not pinned to a sha256 digest"]);
    // Anchored step mappings (block and flow) and literal job matrix image references are checked.
    expect(
      unpinnedActionReferences(
        [
          "jobs:",
          "  first:",
          "    steps:",
          "      - &checkout",
          "        uses: actions/checkout@v7",
          "  second:",
          "    steps:",
          "      - *checkout",
          "      - &inline_key uses: actions/checkout@v7",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "<memory>:5: actions/checkout@v7 is not pinned to a full commit SHA",
      "<memory>:5: actions/checkout@v7 is not pinned to a full commit SHA",
      "<memory>:9: actions/checkout@v7 is not pinned to a full commit SHA",
    ]);
    // Multiline quoted scalars followed by YAML comments must not swallow later steps.
    const multilineCommentWorkflow = [
      "jobs:",
      "  test:",
      "    runs-on: ubuntu-24.04",
      "    steps:",
      '      - name: "Multi-line quoted',
      '          step title" # trailing YAML comment',
      "        uses: actions/checkout@v7",
      "      - run: cid=$(docker run -d node:24)",
      "",
    ].join("\n");
    expect(unpinnedActionReferences(multilineCommentWorkflow)).toEqual([
      "<memory>:7: actions/checkout@v7 is not pinned to a full commit SHA",
    ]);
    expect(unpinnedWorkflowContainerReferences(multilineCommentWorkflow)).toEqual([
      "<memory>:8: node:24 is not pinned to a sha256 digest",
    ]);
    expect(
      unpinnedWorkflowContainerReferences(`      - run: cid=$(docker run -d node:24@${digest})\n`),
    ).toEqual([]);
    // Nested object-valued matrix entries (`matrix.platform.image`) are resolved.
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "jobs:",
          "  matrix-objects:",
          "    strategy:",
          "      matrix:",
          "        platform:",
          "          - runner: ubuntu-24.04",
          "            image: node:24",
          "          - runner: ubuntu-24.04-arm",
          `            image: node:24@${digest}`,
          "    container: ${{ matrix.platform.image }}",
          "    steps:",
          "      - run: docker pull ${{ matrix.platform.image }}",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "<memory>:7: node:24 is not pinned to a sha256 digest",
      "<memory>:7: node:24 is not pinned to a sha256 digest",
    ]);
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "jobs:",
          "  matrix-images:",
          "    strategy:",
          "      matrix:",
          "        image:",
          "          - node:24",
          `          - node:24@${digest}`,
          "        include:",
          "          - extra: alpine:3.20",
          "    container: ${{ matrix.image }}",
          "    steps:",
          "      - run: docker pull ${{ matrix.extra }}",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "<memory>:6: node:24 is not pinned to a sha256 digest",
      "<memory>:9: alpine:3.20 is not pinned to a sha256 digest",
    ]);
    // Matrix `include` merges into matching base rows (including all original rows
    // when an include introduces only new keys), and `exclude` removes dropped rows.
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "jobs:",
          "  matrix-merge:",
          "    strategy:",
          "      matrix:",
          "        repo:",
          "          - node",
          "          - dropped",
          "        exclude:",
          "          - repo: dropped",
          "        include:",
          "          - repo: node",
          "            tag: 24",
          "    container: ${{ matrix.repo }}:${{ matrix.tag }}",
          "",
        ].join("\n"),
      ),
    ).toEqual(["<memory>:12: node:24 is not pinned to a sha256 digest"]);
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "jobs:",
          "  matrix-include-new-keys:",
          "    strategy:",
          "      matrix:",
          "        repo:",
          "          - node",
          "        include:",
          "          - tag: 24",
          "    container: ${{ matrix.repo }}:${{ matrix.tag }}",
          "",
        ].join("\n"),
      ),
    ).toEqual(["<memory>:8: node:24 is not pinned to a sha256 digest"]);
    // Actions `${{ env.* }}` evaluates before shell reassignment, shell heredocs
    // are executed while quoted data heredocs and multiline quoted strings are
    // inert, command substitutions evaluate with current shell variables (not in
    // quoted data heredocs), subshell assignments do not leak to the parent scope,
    // `sh -c` / `bash -eu -c` scripts are inspected, arithmetic `<<` is not a
    // heredoc, subshell `)` stays out of digests, and Podman-specific options
    // (`--authfile`) are skipped before the image operand.
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "jobs:",
          "  shell-semantics:",
          "    runs-on: ubuntu-24.04",
          "    steps:",
          "      - env:",
          `          IMAGE: node:24@${digest}`,
          "        run: |",
          "          IMAGE=node:24",
          '          docker pull "${{ env.IMAGE }}"',
          "          printf 'example:\n          docker pull alpine:3.20\n          '",
          `          (docker pull node:24@${digest})`,
          `          podman run --rm --authfile ci-auth.json node:24@${digest} node -v`,
          "          x=$((1 << 4))",
          "          cat <<'EOF'",
          "          $(docker run -d node:24)",
          "          EOF",
          "          image=node:24",
          '          cid=$(docker run -d "$image")',
          `          (image=node:24@${digest})`,
          '          docker pull "$image"',
          "          sh -c 'docker pull alpine:3.20'",
          `          bash -eu -c "docker pull node:24@${digest}"`,
          "          bash <<'SH'",
          "          docker pull alpine:3.20",
          "          SH",
          "          podman run --rm --authfile ci-auth.json node:24 node -v",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "<memory>:19: node:24 is not pinned to a sha256 digest",
      "<memory>:19: node:24 is not pinned to a sha256 digest",
      "<memory>:23: alpine:3.20 is not pinned to a sha256 digest",
      "<memory>:26: alpine:3.20 is not pinned to a sha256 digest",
      "<memory>:28: node:24 is not pinned to a sha256 digest",
    ]);
    expect(
      unpinnedWorkflowContainerReferences(
        "      - name: Multi\n        run: docker version && docker pull node:24\n",
      ),
    ).toEqual(["<memory>:2: node:24 is not pinned to a sha256 digest"]);
    expect(
      unpinnedWorkflowContainerReferences(
        `      - name: Multi\n        run: docker pull rust:1.96-alpine@${digest} && docker run --rm node:24-alpine node -v\n`,
      ),
    ).toEqual(["<memory>:2: node:24-alpine is not pinned to a sha256 digest"]);
    expect(
      unpinnedWorkflowContainerReferences(
        '      - name: Smoke\n        run: >\n          docker run --rm\n          -v "$PWD:/workspace"\n          node:24-alpine\n          node -v\n',
      ),
    ).toEqual(["<memory>:5: node:24-alpine is not pinned to a sha256 digest"]);
    expect(
      unpinnedWorkflowContainerReferences(
        `      - name: Smoke\n        run: >\n          docker run --rm\n          -v "$PWD:/workspace"\n          node:24-alpine@${digest}\n          node -v\n`,
      ),
    ).toEqual([]);

    // Containerfiles/Dockerfiles must pin FROM, external COPY --from stages,
    // BuildKit `# syntax=` frontends, and `RUN --mount=...,from=` sources,
    // resolve static ARG defaults embedded in image references, reject self-named
    // unpinned stages, and allow `scratch` and earlier build stage aliases.
    expect(
      unpinnedContainerfileReferences(
        `# syntax=docker/dockerfile:1\nARG NODE_VERSION=24\nFROM alpine AS alpine\nFROM node:\${NODE_VERSION} AS build\nRUN --mount=type=bind,from=golang:1.24,source=/bin,target=/tmp/bin true\nCOPY --from=build /app /app\nCOPY --from=busybox:1.37 /bin/sh /bin/sh\nFROM scratch\n`,
      ),
    ).toEqual([
      "<memory>:1: docker/dockerfile:1 is not pinned to a sha256 digest",
      "<memory>:3: alpine is not pinned to a sha256 digest",
      "<memory>:4: node:24 is not pinned to a sha256 digest",
      "<memory>:5: golang:1.24 is not pinned to a sha256 digest",
      "<memory>:7: busybox:1.37 is not pinned to a sha256 digest",
    ]);
    expect(
      unpinnedContainerfileReferences(
        `# syntax=docker/dockerfile:1@${digest}\nFROM rust:1.96-bookworm@${digest} AS toolchain\nFROM node:24-bookworm@${digest} AS build\nCOPY <<'EOF' /tmp/docs.txt\nFROM ubuntu:latest\nEOF\nRUN --mount=type=bind,from=toolchain,source=/usr/local,target=/mnt/rust --mount=type=bind,from=golang:1.24@${digest},source=/bin,target=/mnt/go true\nCOPY --from=toolchain /usr/local/cargo /usr/local/cargo\nFROM build AS runtime\n`,
      ),
    ).toEqual([]);
    // Arithmetic shift `<<` inside Dockerfile `RUN` must not be mistaken for a heredoc,
    // and full-line comments inside backslash-continued instructions are skipped.
    expect(
      unpinnedContainerfileReferences(
        `FROM node:24-bookworm@${digest} AS build\nRUN echo "$((1 << 4))"\nFROM alpine:3.20\n`,
      ),
    ).toEqual(["<memory>:3: alpine:3.20 is not pinned to a sha256 digest"]);
    expect(
      unpinnedContainerfileReferences(
        `FROM \\\n  # runtime base\n  node:24@${digest} AS runtime\n`,
      ),
    ).toEqual([]);
    expect(
      unpinnedContainerfileReferences(
        `# escape=\`\nFROM \`\n  # windows base\n  node:24@${digest} AS runtime\n`,
      ),
    ).toEqual([]);
    // Dockerfile parser directives stop after an ordinary comment or blank line,
    // and `${ARG:-default}` fallbacks in `FROM` are resolved and checked.
    expect(
      unpinnedContainerfileReferences(
        `# License header\n# syntax=docker/dockerfile:1\nARG BASE\nFROM \${BASE:-node:24}\n`,
      ),
    ).toEqual(["<memory>:4: node:24 is not pinned to a sha256 digest"]);
    // Podman pulls check every image operand, local sha256 image IDs are accepted
    // for `run`/`create` (not `pull`), and Windows runners default to PowerShell
    // (including Windows-only steps in mixed-OS matrices).
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "jobs:",
          "  podman-and-windows:",
          "    runs-on: windows-latest",
          "    steps:",
          "      - run: |",
          "          docker run --rm `",
          `            node:24@${digest} \``,
          "            node -v",
          `          docker run --rm ${digest} node -v`,
          `          docker pull ${digest}`,
          `          podman pull node:24@${digest} alpine:3.20`,
          "",
        ].join("\n"),
      ),
    ).toEqual([
      `<memory>:10: ${digest} is not pinned to a sha256 digest`,
      "<memory>:11: alpine:3.20 is not pinned to a sha256 digest",
    ]);
    // Mixed-OS matrix narrows default shell per applicable runner (`if: runner.os == 'Windows'`),
    // `cmd` resolves `%IMAGE%` / `set IMAGE=...`, PowerShell tracks `$image = ...`,
    // and `printf 'IMAGE=%s\n' "$image" >> "$GITHUB_ENV"` expands format arguments.
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "jobs:",
          "  mixed-os-and-shells:",
          "    strategy:",
          "      matrix:",
          "        os: [ubuntu-latest, windows-latest]",
          "    runs-on: ${{ matrix.os }}",
          "    steps:",
          "      - if: runner.os == 'Windows'",
          "        run: |",
          "          docker run --rm `",
          `            node:24@${digest} \``,
          "            node -v",
          `          $pinned = "node:24@${digest}"`,
          "          docker pull $pinned",
          '          $unpinned = "alpine:3.20"',
          "          docker pull $unpinned",
          "      - shell: cmd",
          "        env:",
          `          PINNED: node:24@${digest}`,
          "          UNPINNED: busybox:1.37",
          "        run: |",
          "          docker pull %PINNED%",
          "          docker pull %UNPINNED%",
          "      - shell: bash",
          "        run: |",
          `          pinned="node:24@${digest}"`,
          '          printf \'PINNED_ENV=%s\\n\' "$pinned" >> "$GITHUB_ENV"',
          '          printf \'UNPINNED_ENV=%s\\n\' "redis:7" >> "$GITHUB_ENV"',
          "          printf 'IGNORED=%d\\n' 42 >> \"$GITHUB_ENV\"",
          "      - shell: bash",
          "        run: |",
          '          docker pull "$PINNED_ENV"',
          '          docker pull "$UNPINNED_ENV"',
          '          docker pull "$IGNORED"',
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "<memory>:15: alpine:3.20 is not pinned to a sha256 digest",
      "<memory>:20: busybox:1.37 is not pinned to a sha256 digest",
      "<memory>:28: redis:7 is not pinned to a sha256 digest",
    ]);
    // Lowercase `dockerfile` and explicitly referenced non-standard build files
    // (`docker/build-push-action` `with.file` and `docker build -f`) are discovered
    // and checked; shell `${VAR:-default}` fallbacks, PowerShell `$env:VAR` vs
    // local `$var` isolation, and per-row `shell: ${{ matrix.shell }}` are enforced.
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "jobs:",
          "  param-pwsh-and-matrix-shell:",
          "    strategy:",
          "      matrix:",
          "        include:",
          "          - os: ubuntu-latest",
          "            shell: bash",
          "          - os: windows-latest",
          "            shell: cmd",
          "    runs-on: ${{ matrix.os }}",
          "    steps:",
          "      - shell: bash",
          '        run: docker pull "${UNSET_IMAGE:-node:24}"',
          "      - shell: pwsh",
          "        env:",
          "          IMAGE: alpine:3.20",
          "        run: |",
          `          $image = "alpine:3.20@${digest}"`,
          "          docker pull $image",
          "          docker pull $env:IMAGE",
          "      - if: matrix.shell == 'cmd'",
          "        shell: ${{ matrix.shell }}",
          "        env:",
          `          PINNED: node:24@${digest}`,
          "        run: docker pull %PINNED%",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "<memory>:13: node:24 is not pinned to a sha256 digest",
      "<memory>:16: alpine:3.20 is not pinned to a sha256 digest",
    ]);
    // Case-insensitive matrix property lookup (`IMAGE` -> `${{ matrix.image }}`),
    // unset-state preservation across shell branches (`${IMAGE:-fallback}` and
    // `${IMAGE-fallback}`), `working-directory`-relative build files, and
    // `--build-arg` / `build-args` overrides against pinned Dockerfile defaults.
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "jobs:",
          "  matrix-case-and-unset-branch:",
          "    strategy:",
          "      matrix:",
          "        IMAGE:",
          "          - redis:7",
          "    container: ${{ matrix.image }}",
          "    runs-on: ubuntu-24.04",
          "    steps:",
          "      - run: |",
          '          if [ "$USE_PINNED" = "1" ]; then',
          `            MAYBE_IMG=node:24@${digest}`,
          "          fi",
          '          docker pull "${MAYBE_IMG:-alpine:3.20}"',
          '          docker pull "${MAYBE_IMG-busybox:1.37}"',
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "<memory>:6: redis:7 is not pinned to a sha256 digest",
      "<memory>:14: alpine:3.20 is not pinned to a sha256 digest",
      "<memory>:15: busybox:1.37 is not pinned to a sha256 digest",
    ]);
    // Conditional `GITHUB_ENV` writes preserve the unset state for later fallbacks,
    // executable paths (`/usr/bin/docker`, `docker.exe`) are recognized, matrix
    // `working-directory` and variable build contexts resolve every target build
    // file, named `--build-context` / `build-contexts` images are checked, and
    // build-arg expansion filters to referenced args while reporting overflow.
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "jobs:",
          "  paths-and-conditional-env:",
          "    runs-on: ubuntu-24.04",
          "    steps:",
          "      - if: github.event_name == 'push'",
          `        run: echo "COND_IMG=node:24@${digest}" >> "$GITHUB_ENV"`,
          '      - run: /usr/bin/docker pull "${COND_IMG:-alpine:3.20}"',
          "      - shell: pwsh",
          "        run: C:\\Docker\\docker.exe pull busybox:1.37",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "<memory>:7: alpine:3.20 is not pinned to a sha256 digest",
      "<memory>:9: busybox:1.37 is not pinned to a sha256 digest",
    ]);
    const fixtureRoot = await mkdtemp(join(tmpdir(), "palamedes-pins-lowercase-"));
    try {
      await mkdir(join(fixtureRoot, ".github", "actions", "local-docker"), { recursive: true });
      await mkdir(join(fixtureRoot, ".github", "workflows"), { recursive: true });
      await mkdir(join(fixtureRoot, "ci", "images"), { recursive: true });
      await mkdir(join(fixtureRoot, "ci", "app-a"), { recursive: true });
      await mkdir(join(fixtureRoot, "ci", "app-b"), { recursive: true });
      await mkdir(join(fixtureRoot, "ci", "ctx"), { recursive: true });
      await writeFile(
        join(fixtureRoot, ".github", "actions", "local-docker", "action.yml"),
        "name: Local\nruns:\n  using: docker\n  image: ./dockerfile\n",
      );
      await writeFile(
        join(fixtureRoot, ".github", "actions", "local-docker", "dockerfile"),
        "FROM node:24\n",
      );
      await writeFile(
        join(fixtureRoot, ".github", "workflows", "build.yml"),
        [
          "jobs:",
          "  build:",
          "    strategy:",
          "      matrix:",
          "        dir: [ci/app-a, ci/app-b]",
          "    runs-on: ubuntu-24.04",
          "    steps:",
          "      - uses: docker/build-push-action@1111111111111111111111111111111111111111 # v6",
          "        with:",
          "          file: ci/images/runtime.build",
          "          build-args: |",
          "            BASE=alpine:3.20",
          "          build-contexts: |",
          `            pinnedctx=docker-image://node:24@${digest}`,
          "            badctx=docker-image://redis:7",
          "      - working-directory: ${{ matrix.dir }}",
          "        run: docker build -f cli.recipe .",
          "      - run: |",
          "          ctx=ci/ctx",
          '          docker build --build-arg CTX_BASE=busybox:1.37 "$ctx"',
          "",
        ].join("\n"),
      );
      await writeFile(
        join(fixtureRoot, "ci", "images", "runtime.build"),
        `ARG BASE=alpine:3.20@${digest}\nFROM pinnedctx AS base\nFROM \${BASE}\n`,
      );
      await writeFile(join(fixtureRoot, "ci", "app-a", "cli.recipe"), `FROM node:24@${digest}\n`);
      await writeFile(join(fixtureRoot, "ci", "app-b", "cli.recipe"), "FROM ubuntu:24.04\n");
      await writeFile(
        join(fixtureRoot, "ci", "ctx", "Dockerfile"),
        `ARG CTX_BASE=busybox:1.37@${digest}\nFROM \${CTX_BASE}\n`,
      );
      const fixtureResult = checkWorkflowPins(fixtureRoot);
      expect(fixtureResult.containerFilesChecked).toBe(5);
      expect(fixtureResult.problems).toEqual([
        ".github/workflows/build.yml:14: redis:7 is not pinned to a sha256 digest",
        ".github/actions/local-docker/dockerfile:1: node:24 is not pinned to a sha256 digest",
        "ci/app-b/cli.recipe:1: ubuntu:24.04 is not pinned to a sha256 digest",
        "ci/images/runtime.build:3: alpine:3.20 is not pinned to a sha256 digest",
        "ci/ctx/Dockerfile:2: busybox:1.37 is not pinned to a sha256 digest",
      ]);
      // Irrelevant multi-valued build-args do not mask an unpinned 9th base image,
      // and nested `${BASE:-$DEFAULT_BASE}` fallback ARGs are resolved.
      expect(
        unpinnedContainerfileReferences("ARG BASE\nARG UNUSED\nFROM ${BASE}\n", "<memory>", {
          argOverrides: new Map([
            [
              "BASE",
              {
                values: [
                  ...Array.from({ length: 8 }, (_, idx) => `node:${idx}@${digest}`),
                  "alpine:3.20",
                ],
                truncated: false,
              },
            ],
            [
              "UNUSED",
              { values: Array.from({ length: 8 }, (_, idx) => `v${idx}`), truncated: false },
            ],
          ]),
        }),
      ).toEqual(["<memory>:3: alpine:3.20 is not pinned to a sha256 digest"]);
      expect(
        unpinnedContainerfileReferences(
          "ARG DEFAULT_BASE=alpine:3.20\nARG BASE\nFROM ${BASE:-$DEFAULT_BASE}\n",
        ),
      ).toEqual(["<memory>:3: alpine:3.20 is not pinned to a sha256 digest"]);
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
    // Bundled short Docker options (`-itv`), `buildah pull` / `buildah from`,
    // `cd`-relative build files, per-row shell build-arg pairing, non-universal
    // named contexts, and repository-local symlinked Dockerfiles.
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "steps:",
          `  - run: docker run -itv cache:/cache node:24@${digest} node -v`,
          "  - run: buildah from scratch",
          "  - run: buildah pull alpine:3.20",
          "  - run: buildah from busybox:1.37",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "<memory>:4: alpine:3.20 is not pinned to a sha256 digest",
      "<memory>:5: busybox:1.37 is not pinned to a sha256 digest",
    ]);
    // Stdin Dockerfiles (`docker build -f - .` and positional `docker build -`,
    // including conditional shell expansions), `docker/bake-action` fail-closed
    // diagnostics, alternative `cd` targets, shell-local vs exported name-only
    // `--build-arg`, and parent-dir symlink escapes.
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "jobs:",
          "  stdin-and-bake:",
          "    runs-on: ubuntu-24.04",
          "    steps:",
          "      - run: |",
          "          docker build -f - . <<'EOF'",
          "          FROM alpine:3.20",
          "          EOF",
          `          BASE=node:24@${digest}`,
          '          if [ "$USE_FLOATING" = "1" ]; then',
          "            BASE=redis:7",
          "          fi",
          "          docker build - <<EOF",
          "          FROM $BASE",
          "          EOF",
          "      - uses: docker/bake-action@1111111111111111111111111111111111111111 # v6",
          "        with:",
          "          files: docker-bake.hcl",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "<memory>:7: alpine:3.20 is not pinned to a sha256 digest",
      "<memory>:14: redis:7 is not pinned to a sha256 digest",
      "<memory>:16: docker/bake-action target definitions cannot be verified statically for container image digests",
    ]);
    const symlinkFixture = await mkdtemp(join(tmpdir(), "palamedes-pins-symlink-"));
    const outsideDir = await mkdtemp(join(tmpdir(), "palamedes-pins-outside-"));
    try {
      await mkdir(join(symlinkFixture, ".github", "workflows"), { recursive: true });
      await mkdir(join(symlinkFixture, "ci", "nested-a"), { recursive: true });
      await mkdir(join(symlinkFixture, "ci", "nested-b"), { recursive: true });
      await writeFile(join(outsideDir, "escaped.recipe"), "FROM alpine:3.20\n");
      await symlink(outsideDir, join(symlinkFixture, "ci", "escaped-link"));
      await writeFile(join(symlinkFixture, "ci", "target.recipe"), "FROM alpine:3.20\n");
      await symlink("ci/target.recipe", join(symlinkFixture, "Dockerfile"));
      await writeFile(
        join(symlinkFixture, "ci", "nested-a", "cd.recipe"),
        `FROM node:24@${digest}\n`,
      );
      await writeFile(join(symlinkFixture, "ci", "nested-b", "cd.recipe"), "FROM busybox:1.37\n");
      await writeFile(
        join(symlinkFixture, "ci", "arg-env.recipe"),
        `ARG BASE=node:24@${digest}\nFROM \${BASE}\n`,
      );
      await writeFile(
        join(symlinkFixture, "ci", "arg-local.recipe"),
        `ARG BASE=node:24@${digest}\nFROM \${BASE}\n`,
      );
      await writeFile(join(symlinkFixture, "ci", "shared.recipe"), "FROM maybectx\n");
      await writeFile(
        join(symlinkFixture, ".github", "workflows", "cd-and-ctx.yml"),
        [
          "jobs:",
          "  build:",
          "    runs-on: ubuntu-24.04",
          "    steps:",
          "      - run: |",
          "          DIR=ci/nested-a",
          '          if [ "$ALT" = "1" ]; then',
          "            DIR=ci/nested-b",
          "          fi",
          '          cd "$DIR"',
          "          docker build -f cd.recipe .",
          "      - run: |",
          "          BASE=ubuntu:24.04",
          "          docker build --build-arg BASE -f ci/arg-local.recipe .",
          `          BASE=node:24@${digest}`,
          "          BASE=redis:7 docker build --build-arg BASE -f ci/arg-env.recipe .",
          `      - run: docker build --build-context maybectx=docker-image://node:24@${digest} -f ci/shared.recipe .`,
          "      - run: docker build -f ci/shared.recipe .",
          "      - run: docker build -f ci/escaped-link/escaped.recipe .",
          "",
        ].join("\n"),
      );
      const symlinkResult = checkWorkflowPins(symlinkFixture);
      expect(symlinkResult.problems).toEqual([
        "ci/escaped-link/escaped.recipe:1: symlink target escapes repository root and cannot be verified",
        "ci/nested-b/cd.recipe:1: busybox:1.37 is not pinned to a sha256 digest",
        "ci/shared.recipe:1: maybectx is not pinned to a sha256 digest",
        "ci/target.recipe:1: alpine:3.20 is not pinned to a sha256 digest",
        "ci/arg-env.recipe:2: redis:7 is not pinned to a sha256 digest",
      ]);
    } finally {
      await rm(symlinkFixture, { recursive: true, force: true });
      await rm(outsideDir, { recursive: true, force: true });
    }
    // Case-insensitive workflow schema keys (`Jobs`, `Steps`, `Uses`) are checked.
    expect(
      unpinnedActionReferences(
        ["Jobs:", "  build:", "    Steps:", "      - Uses: actions/checkout@v7", ""].join("\n"),
      ),
    ).toEqual(["<memory>:4: actions/checkout@v7 is not pinned to a full commit SHA"]);
    // PowerShell backtick continuations (from step or default shell), literal
    // `for ... in` image lists, and fail-closed expansion-limit diagnostics.
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "defaults:",
          "  run:",
          "    shell: pwsh",
          "jobs:",
          "  win:",
          "    steps:",
          "      - run: |",
          "          docker run --rm `",
          `            node:24@${digest} \``,
          "            node -v",
          "      - shell: bash",
          "        run: |",
          `          for img in node:24@${digest} alpine:3.20; do`,
          '            docker pull "$img"',
          "          done",
          "",
        ].join("\n"),
      ),
    ).toEqual(["<memory>:13: alpine:3.20 is not pinned to a sha256 digest"]);
    const overflowList = [
      ...Array.from({ length: 32 }, (_, idx) => `node:${idx}@${digest}`),
      "alpine:3.20",
    ].join(" ");
    expect(
      unpinnedWorkflowContainerReferences(
        `steps:\n  - run: |\n      for img in ${overflowList}; do\n        docker pull "$img"\n      done\n`,
      ),
    ).toEqual(["<memory>:4: $img exceeds expansion limit and cannot be verified exhaustively"]);
    // Empty quoted arguments (`--entrypoint ''`), branch-reachable shell
    // assignments, command-local prefix assignment scoping, `GITHUB_ENV`
    // propagation into subsequent steps (not the writing step), and pre-cutoff
    // matrix exclusion / fail-closed truncation are all enforced.
    expect(
      unpinnedWorkflowContainerReferences(
        `steps:\n  - run: docker run --entrypoint '' node:24@${digest} node -v\n`,
      ),
    ).toEqual([]);
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "jobs:",
          "  branch-and-env:",
          "    runs-on: ubuntu-24.04",
          "    steps:",
          "      - run: |",
          "          IMAGE=node:24",
          '          if [ "$USE_PINNED" = "1" ]; then',
          `            IMAGE=node:24@${digest}`,
          "          fi",
          '          docker pull "$IMAGE"',
          "          LOCAL=alpine:3.20",
          `          LOCAL=alpine:3.20@${digest} docker pull "$LOCAL"`,
          '          echo "NEXT_IMAGE=busybox:1.37" >> "$GITHUB_ENV"',
          '          docker pull "$NEXT_IMAGE"',
          '      - run: docker pull "$NEXT_IMAGE"',
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "<memory>:6: node:24 is not pinned to a sha256 digest",
      "<memory>:11: alpine:3.20 is not pinned to a sha256 digest",
      "<memory>:13: busybox:1.37 is not pinned to a sha256 digest",
    ]);
    const bigAxis = Array.from({ length: 20 }, (_, idx) => `          - ${idx}`).join("\n");
    const bigExcludes = Array.from({ length: 18 }, (_, idx) => `          - a: ${idx}`).join("\n");
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "jobs:",
          "  pruned-matrix:",
          "    strategy:",
          "      matrix:",
          "        a:",
          bigAxis,
          "        b:",
          bigAxis,
          "        exclude:",
          bigExcludes,
          "        include:",
          "          - a: 19",
          "            b: 19",
          "            image: node:24",
          "    container: ${{ matrix.image }}",
          "",
        ].join("\n"),
      ),
    ).toEqual(["<memory>:69: node:24 is not pinned to a sha256 digest"]);
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "jobs:",
          "  oversized-matrix:",
          "    strategy:",
          "      matrix:",
          "        a:",
          bigAxis,
          "        b:",
          bigAxis,
          `    container: node:24@${digest}`,
          "",
        ].join("\n"),
      ),
    ).toEqual(["<memory>:5: matrix exceeds 256 combinations and cannot be verified exhaustively"]);

    // Renovate custom manager extracts the digest-pinned musl action images.
    const [renovateConfig, verifyMuslAction] = await Promise.all([
      readRepositoryFile("renovate.json").then(JSON.parse),
      readRepositoryFile(".github/actions/verify-musl-native/action.yml"),
    ]);
    const manager = renovateConfig.customManagers?.find(
      (entry) => entry.customType === "regex" && entry.datasourceTemplate === "docker",
    );
    expect(manager).toBeDefined();
    const pattern = new RegExp(manager.matchStrings[0], "gu");
    const extracted = [...verifyMuslAction.matchAll(pattern)].map((match) => ({
      depName: match.groups.depName,
      currentValue: match.groups.currentValue,
      hasDigest: /^sha256:[0-9a-f]{64}$/u.test(match.groups.currentDigest),
    }));
    expect(extracted).toEqual([
      { depName: "rust", currentValue: `${rustVersion}-alpine`, hasDigest: true },
      { depName: "node", currentValue: "24-alpine", hasDigest: true },
      { depName: "node", currentValue: "24-alpine", hasDigest: true },
    ]);
    for (const fileName of [".github/actions/verify-musl-native/action.yml", "Containerfile"]) {
      const rules = (renovateConfig.packageRules ?? []).filter((rule) =>
        rule.matchFileNames?.includes(fileName),
      );
      expect(
        rules.some(
          (rule) =>
            rule.enabled === false &&
            ["major", "minor", "patch"].every((type) => rule.matchUpdateTypes?.includes(type)),
        ),
        fileName,
      ).toBe(true);
      expect(
        rules.some((rule) => rule.enabled === true && rule.matchUpdateTypes?.includes("digest")),
        fileName,
      ).toBe(true);
    }
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

  it("redeploys the site after Publish uploads a release", async () => {
    const [deploySite, publish] = await Promise.all([
      readRepositoryFile(".github/workflows/deploy-site.yml"),
      readRepositoryFile(".github/workflows/publish.yml"),
    ]);
    const publishName = /^name: (.+)$/mu.exec(publish)?.[1];

    // The framework pages read npm versions at build time, so the push run for
    // the release commit alone would snapshot npm before the upload.
    expect(deploySite).toContain(
      `  workflow_run:\n    workflows:\n      - ${publishName}\n    types:\n      - completed\n    branches:\n      - main\n`,
    );
    // Only successful push runs for a release commit; dry runs are dispatches.
    const build = job(deploySite, "build", "deploy");
    expect(build).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(build).toContain("github.event.workflow_run.event == 'push'");
    expect(build).toContain(
      "startsWith(github.event.workflow_run.head_commit.message, 'chore: release main')",
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
      "node ./scripts/prebuild-content.mjs && ardo dev --port 4100",
    );

    const buildSteps = [
      "node ../scripts/verify-site-bench-data.mjs",
      "node ../scripts/check-example-matrix.mjs",
      "node ../scripts/verify-site-editorial-rails.mjs",
      "node ../scripts/verify-site-streamline-assets.mjs",
      "node ./scripts/generate-og-images.mjs --check",
      "node ./scripts/prebuild-content.mjs",
      "ardo build",
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
