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
    expect(audit.text).toContain("upload_report_outcome: ${{ steps.upload-report.outcome }}");

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
    expect(report.text).toContain("needs.audit.result != 'cancelled'");
    expect(report.text).toContain("needs.audit.outputs.upload_report_outcome == 'success'");
    expect(report.text).not.toContain("needs.audit.result == 'success'");
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
    expect(report.text).toContain(
      '(contractOutcome === "skipped" || contractOutcome === "success")',
    );
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

  it("pins every third-party action and container image to an immutable digest", () => {
    const { checked, containerFilesChecked, problems } = checkWorkflowPins(repositoryRoot);

    expect(problems).toEqual([]);
    expect(checked).toBeGreaterThan(0);
    expect(containerFilesChecked).toBeGreaterThan(0);
  });

  it("validates action, YAML anchor, env, and matrix pin references", () => {
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
      "<memory>:7: node:24 is not pinned to a sha256 digest",
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
      "<memory>:12: node:24 is not pinned to a sha256 digest",
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
      "<memory>:12: alpine:3.20 is not pinned to a sha256 digest",
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
  });

  it("validates POSIX, PowerShell, and cmd shell container commands", () => {
    const digest = `sha256:${"a".repeat(64)}`;
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
    // PowerShell scoped/environment variables (`$env:IMAGE_ID`, `$global:IMAGE_ID`)
    // are treated as opaque runtime image IDs rather than `:tag` suffixes, while
    // literal tags after PowerShell variables (`$env:REGISTRY/app:latest`,
    // `${env:REPO}:latest`) are still rejected; and print-only/list-only
    // `docker buildx bake` invocations are allowed while real builds fail closed.
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "jobs:",
          "  windows:",
          "    runs-on: windows-latest",
          "    steps:",
          "      - run: |",
          "          docker run --rm $env:IMAGE_ID node -v",
          '          docker run --rm "$global:IMAGE_ID" node -v',
          '          docker run --rm "$env:REGISTRY/app:latest" node -v',
          '          docker run --rm "${env:REPO}:v1.2" node -v',
          "  bake:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - run: |",
          "          docker buildx bake --print",
          "          docker buildx bake -f docker-bake.hcl --print=true default",
          "          docker buildx bake --list=targets",
          "          docker buildx bake --print=false",
          "          docker buildx bake --set app.args.FLAG=--print",
          "          docker buildx bake -- --print",
          "  compose:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - run: |",
          "          docker compose down",
          "          docker compose logs",
          "          docker compose config",
          "          docker compose --dry-run up",
          "          docker compose build --print",
          "          docker compose build --print=false",
          "          docker compose run --help",
          "          docker compose run --rm app --help",
          "          docker compose up -d",
          "          docker-compose pull",
          "          docker compose -f - up <<'EOF'",
          "          services:",
          "            db:",
          "              image: postgres:16",
          "          EOF",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "<memory>:8: $env:REGISTRY/app:latest is not pinned to a sha256 digest",
      "<memory>:9: ${env:REPO}:v1.2 is not pinned to a sha256 digest",
      "<memory>:17: docker buildx bake target definitions cannot be verified statically for container image digests",
      "<memory>:18: docker buildx bake target definitions cannot be verified statically for container image digests",
      "<memory>:19: docker buildx bake target definitions cannot be verified statically for container image digests",
      "<memory>:29: docker compose build target definitions cannot be verified statically for container image digests",
      "<memory>:31: docker compose run target definitions cannot be verified statically for container image digests",
      "<memory>:32: docker compose up target definitions cannot be verified statically for container image digests",
      "<memory>:33: docker-compose pull target definitions cannot be verified statically for container image digests",
      "<memory>:34: docker compose up target definitions cannot be verified statically for container image digests",
    ]);
  });

  it("discovers and verifies Containerfiles, build contexts, build args, and symlinks", async () => {
    const digest = `sha256:${"a".repeat(64)}`;
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
    // `docker buildx bake` CLI fails closed, `--blkio-weight-device` consumes
    // its value, `unset` clears/marks variables unset, unexported parent vars do
    // not leak into single-quoted `sh -c`, BuildKit forward `COPY --from` stage
    // references are accepted, `COPY` matches `--from=` only in its option list,
    // `ARG BASE=` preserves empty defaults vs undeclared ARGs, and `docker buildx`
    // global options (`--builder`) are parsed before `build`/`bake`.
    expect(
      unpinnedContainerfileReferences(
        [
          "FROM scratch AS builder",
          "COPY --from=assets /data /data",
          "COPY ./files/from--from=stage /tmp/",
          "COPY --from=alpine:3.20 ./files/x--from=builder /tmp/",
          "FROM scratch AS assets",
          "",
        ].join("\n"),
      ),
    ).toEqual(["<memory>:4: alpine:3.20 is not pinned to a sha256 digest"]);
    expect(unpinnedContainerfileReferences("ARG BASE=\nFROM ${BASE:-scratch}\n")).toEqual([]);
    expect(
      unpinnedContainerfileReferences("ARG BASE=\nFROM ${BASE:-scratch}\n", "<memory>", {
        argOverrides: new Map([["BASE", { values: ["alpine:3.20"], truncated: false }]]),
      }),
    ).toEqual(["<memory>:2: alpine:3.20 is not pinned to a sha256 digest"]);
    expect(unpinnedContainerfileReferences("ARG BASE=\nFROM ${BASE+alpine:3.20}\n")).toEqual([
      "<memory>:2: alpine:3.20 is not pinned to a sha256 digest",
    ]);
    expect(unpinnedContainerfileReferences("ARG BASE\nFROM ${BASE+alpine:3.20}\n")).toEqual([]);
    expect(unpinnedContainerfileReferences("ARG VARIANT\nFROM node:24${VARIANT}\n")).toEqual([
      "<memory>:2: node:24 is not pinned to a sha256 digest",
    ]);
    expect(
      unpinnedContainerfileReferences("ARG VARIANT\nFROM node:24${VARIANT}\n", "<memory>", {
        argOverrides: new Map([["VARIANT", { values: [`@${digest}`], truncated: false }]]),
      }),
    ).toEqual([]);
    // Dockerfile continuations preserve exact token boundaries without inserting
    // extra spaces, and `BUILDKIT_SYNTAX` overrides are checked even without an
    // explicit `ARG BUILDKIT_SYNTAX` declaration.
    expect(unpinnedContainerfileReferences(`FROM node:24@sha256:\\\n${"a".repeat(64)}\n`)).toEqual(
      [],
    );
    expect(
      unpinnedContainerfileReferences(`FROM node:24@${digest}\n`, "<memory>", {
        argOverrides: new Map([
          ["BUILDKIT_SYNTAX", { values: ["docker/dockerfile:1"], truncated: false }],
        ]),
      }),
    ).toEqual(["<memory>:1: docker/dockerfile:1 is not pinned to a sha256 digest"]);
    // `ONBUILD` triggers check external images while permitting downstream stage names.
    expect(
      unpinnedContainerfileReferences(
        [
          `FROM node:24@${digest}`,
          "ONBUILD COPY --from=builder /app /app",
          `ONBUILD COPY --from=alpine:3.20@${digest} /bin/sh /tmp/sh`,
          "ONBUILD COPY --from=alpine:3.20 /bin/sh /tmp/sh",
          "ONBUILD RUN --mount=type=bind,from=golang:1.24,source=/bin,target=/tmp/bin true",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "<memory>:4: alpine:3.20 is not pinned to a sha256 digest",
      "<memory>:5: golang:1.24 is not pinned to a sha256 digest",
    ]);
    // Bash argument arrays preserve expansion truncation across loops.
    const arrayOverflowList = [
      ...Array.from({ length: 32 }, (_, idx) => `node:${idx}@${digest}`),
      "alpine:3.20",
    ].join(" ");
    expect(
      unpinnedWorkflowContainerReferences(
        `steps:\n  - run: |\n      for img in ${arrayOverflowList}; do\n        args=(--rm "$img")\n        docker run "\${args[@]}"\n      done\n`,
      ),
    ).toEqual([
      "<memory>:5: ${args[@]} exceeds expansion limit and cannot be verified exhaustively",
    ]);
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "jobs:",
          "  bake-unset-and-child-env:",
          "    runs-on: ubuntu-24.04",
          "    steps:",
          "      - run: |",
          `          docker run --rm --blkio-weight-device /dev/sda:500 node:24@${digest} node -v`,
          "          IMAGE=node:24",
          `          sh -c 'docker pull "\${IMAGE:-node:24@${digest}}"'`,
          "          unset IMAGE",
          `          docker pull "\${IMAGE:-node:24@${digest}}"`,
          `          CLEARABLE=node:24@${digest}`,
          '          [ "$CLEAR" = "1" ] && unset CLEARABLE',
          '          docker pull "${CLEARABLE:-alpine:3.20}"',
          "          docker buildx bake app",
          "          docker buildx --builder ci bake app",
          "          docker buildx --builder ci build -f - . <<'EOF'",
          "          FROM redis:7",
          "          EOF",
          "          cat ci/build.recipe | docker build -f - .",
          "          buildah --storage-driver vfs pull ubuntu:24.04",
          "          docker build --build-arg BUILDKIT_SYNTAX=docker/dockerfile:1.9 .",
          "          podman build --build-context pctx=container-image://traefik:3 .",
          "          docker buildx create --use --bootstrap",
          "          docker buildx create --driver-opt image=moby/buildkit:v0.35.1",
          `          docker buildx create --driver-opt network=host,image=moby/buildkit:v0.35.1@${digest}`,
          "          docker buildx create --driver docker",
          `          docker run --cpu-count 2 --cpu-percent 50 --io-maxbandwidth 1M --io-maxiops 100 --dns-opt ndots:1 node:24@${digest} node -v`,
          "          sudo -E docker run --rm haproxy:3",
          "          env -i -u HOME docker pull memcached:1.6",
          "          command -v docker",
          "          opts='--rm --platform linux/amd64'",
          `          docker run $opts node:24@${digest} node -v`,
          "          docker run $opts vault:1.18 node -v",
          "          timeout 30s docker pull consul:1.20",
          "          docker build https://github.com/example/shell-remote.git",
          "          args=(--rm nomad:1.9)",
          '          docker run "${args[@]}"',
          `          docker run "\${UNKNOWN_OPTS[@]}" node:24@${digest} node -v`,
          '          docker run "${UNKNOWN_ARGS[@]}"',
          "          unset SUFFIX",
          '          docker pull "alpine:3.20${SUFFIX}"',
          `          export REMOVED_IMG=node:24@${digest}`,
          `          env -u REMOVED_IMG sh -c 'docker pull "\${REMOVED_IMG:-nats:2.10}"'`,
          `          env -i sh -c 'docker pull "\${REMOVED_IMG:-etcd:3.5}"'`,
          "          readonly RO_IMG=clickhouse:25",
          '          docker pull "$RO_IMG"',
          "      - uses: docker/setup-buildx-action@1111111111111111111111111111111111111111 # v4",
          "      - uses: docker/setup-buildx-action@1111111111111111111111111111111111111111 # v4",
          "        with:",
          "          driver-opts: image=moby/buildkit:v0.35.1",
          "      - uses: docker/setup-buildx-action@1111111111111111111111111111111111111111 # v4",
          "        with:",
          `          driver-opts: network=host,image=moby/buildkit:v0.35.1@${digest}`,
          "      - uses: docker/setup-buildx-action@1111111111111111111111111111111111111111 # v4",
          "        with:",
          "          driver: docker",
          "      - uses: docker/build-push-action@1111111111111111111111111111111111111111 # v7",
          "        with:",
          "          build-args: BUILDKIT_SYNTAX=docker/dockerfile:1.10",
          "  case-insensitive-contexts:",
          "    runs-on: ubuntu-24.04",
          "    env:",
          "      BASE_IMG: busybox:1.37",
          "      RUN_FLAGS: --rm",
          "    strategy:",
          "      matrix:",
          "        image: [alpine:3.20]",
          "        flags: ['--platform linux/amd64']",
          "    container: ${{ Matrix.image }}",
          "    steps:",
          "      - run: docker pull ${{ Env.BASE_IMG }}",
          `      - run: docker run \${{ env.RUN_FLAGS }} node:24@${digest} node -v`,
          "      - run: docker run ${{ env.RUN_FLAGS }} caddy:2 node -v",
          `      - run: docker run \${{ matrix.flags }} node:24@${digest} node -v`,
          "      - run: docker run ${{ matrix.flags }} debian:12 node -v",
          "  repeated-literal-env:",
          "    runs-on: ubuntu-24.04",
          "    env:",
          `      IMAGE: node:24@${digest}`,
          "    steps:",
          "      - run: |",
          ...Array.from({ length: 20 }, () => '          echo "${{ env.IMAGE }}"'),
          "  isolated-matrix-github-env:",
          "    runs-on: ubuntu-24.04",
          "    strategy:",
          "      matrix:",
          "        include:",
          "          - mode: display",
          "            ref: node:24",
          "          - mode: run",
          `            ref: node:24@${digest}`,
          "    steps:",
          '      - run: echo "IMAGE=${{ matrix.ref }}" >> "$GITHUB_ENV"',
          "      - if: matrix.mode == 'run'",
          '        run: docker pull "$IMAGE"',
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "<memory>:13: alpine:3.20 is not pinned to a sha256 digest",
      "<memory>:14: docker buildx bake target definitions cannot be verified statically for container image digests",
      "<memory>:15: docker buildx bake target definitions cannot be verified statically for container image digests",
      "<memory>:17: redis:7 is not pinned to a sha256 digest",
      "<memory>:19: stdin containerfile input cannot be verified statically",
      "<memory>:20: ubuntu:24.04 is not pinned to a sha256 digest",
      "<memory>:21: docker/dockerfile:1.9 is not pinned to a sha256 digest",
      "<memory>:22: traefik:3 is not pinned to a sha256 digest",
      "<memory>:23: docker buildx create uses unpinned default BuildKit image (pass --driver-opt image=...@sha256:...)",
      "<memory>:24: moby/buildkit:v0.35.1 is not pinned to a sha256 digest",
      "<memory>:28: haproxy:3 is not pinned to a sha256 digest",
      "<memory>:29: memcached:1.6 is not pinned to a sha256 digest",
      "<memory>:33: vault:1.18 is not pinned to a sha256 digest",
      "<memory>:34: consul:1.20 is not pinned to a sha256 digest",
      "<memory>:35: build context https://github.com/example/shell-remote.git cannot be verified statically",
      "<memory>:36: nomad:1.9 is not pinned to a sha256 digest",
      "<memory>:39: container image operand in ${UNKNOWN_ARGS[@]} cannot be verified statically",
      "<memory>:41: alpine:3.20 is not pinned to a sha256 digest",
      "<memory>:43: nats:2.10 is not pinned to a sha256 digest",
      "<memory>:44: etcd:3.5 is not pinned to a sha256 digest",
      "<memory>:45: clickhouse:25 is not pinned to a sha256 digest",
      "<memory>:47: docker/setup-buildx-action uses unpinned default BuildKit image (pin driver-opts image=...@sha256:...)",
      "<memory>:50: moby/buildkit:v0.35.1 is not pinned to a sha256 digest",
      "<memory>:59: docker/dockerfile:1.10 is not pinned to a sha256 digest",
      "<memory>:67: alpine:3.20 is not pinned to a sha256 digest",
      "<memory>:71: busybox:1.37 is not pinned to a sha256 digest",
      "<memory>:73: caddy:2 is not pinned to a sha256 digest",
      "<memory>:75: debian:12 is not pinned to a sha256 digest",
    ]);
    const buildFixture = await mkdtemp(join(tmpdir(), "palamedes-pins-builds-"));
    try {
      await mkdir(join(buildFixture, ".github", "workflows"), { recursive: true });
      await mkdir(join(buildFixture, "ci", "nested-a"), { recursive: true });
      await mkdir(join(buildFixture, "ci", "nested-b"), { recursive: true });
      await mkdir(join(buildFixture, "ci", "win"), { recursive: true });
      await mkdir(join(buildFixture, "ci", "dual"), { recursive: true });
      await mkdir(join(buildFixture, "ci", "tag-opt"), { recursive: true });
      await mkdir(join(buildFixture, "ci", "cmdsub"), { recursive: true });
      await mkdir(join(buildFixture, "ci", "podman-fmt"), { recursive: true });
      await mkdir(join(buildFixture, "ci", "gitctx"), { recursive: true });
      await writeFile(join(buildFixture, "Dockerfile"), "FROM rootctx\n");
      await writeFile(
        join(buildFixture, "ci", "nested-a", "cd.recipe"),
        `FROM node:24@${digest}\n`,
      );
      await writeFile(join(buildFixture, "ci", "nested-b", "cd.recipe"), "FROM busybox:1.37\n");
      await writeFile(join(buildFixture, "ci", "win", "win.recipe"), "FROM alpine:3.20\n");
      await writeFile(
        join(buildFixture, "ci", "arg-env.recipe"),
        `ARG BASE=node:24@${digest}\nFROM \${BASE}\n`,
      );
      await writeFile(
        join(buildFixture, "ci", "arg-local.recipe"),
        `ARG BASE=node:24@${digest}\nFROM \${BASE}\n`,
      );
      await writeFile(join(buildFixture, "ci", "shared.recipe"), "FROM maybectx\n");
      await writeFile(
        join(buildFixture, "ci", "stdin.recipe"),
        "ARG STDIN_BASE=\nFROM ${STDIN_BASE:-scratch}\n",
      );
      await writeFile(join(buildFixture, "ci", "stdin-attached.recipe"), "FROM debian:12\n");
      await writeFile(join(buildFixture, "ci", "context.tar.gz"), Buffer.from([0x1f, 0x8b, 0x08]));
      await writeFile(
        join(buildFixture, "ci", "arg-empty.recipe"),
        "ARG EMPTY_BASE=\nFROM ${EMPTY_BASE:-scratch}\n",
      );
      await writeFile(
        join(buildFixture, "ci", "dual", "Containerfile"),
        `ARG PODMAN_BASE=node:24@${digest}\nARG BUILDAH_BASE=node:24@${digest}\nFROM \${PODMAN_BASE}\nFROM \${BUILDAH_BASE}\n`,
      );
      await writeFile(
        join(buildFixture, "ci", "dual", "Dockerfile"),
        `ARG DOCKER_BASE=node:24@${digest}\nFROM \${DOCKER_BASE}\n`,
      );
      await writeFile(
        join(buildFixture, "ci", "tag-opt", "Dockerfile"),
        `ARG TAG_BASE=node:24@${digest}\nFROM \${TAG_BASE}\n`,
      );
      await writeFile(join(buildFixture, "ci", "cmdsub", "sub.recipe"), "FROM ruby:3.4\n");
      await writeFile(join(buildFixture, "ci", "popd.recipe"), "FROM perl:5.40\n");
      await writeFile(join(buildFixture, "ci", "short-eq.recipe"), "FROM elixir:1.18\n");
      await writeFile(join(buildFixture, "ci", "workspace.recipe"), "FROM zig:0.14\n");
      await writeFile(join(buildFixture, "ci", "env-chdir.recipe"), "FROM lua:5.4\n");
      await writeFile(join(buildFixture, "ci", "builder-alias.recipe"), "FROM swift:6.0\n");
      await writeFile(
        join(buildFixture, "ci", "podman-fmt", "Containerfile"),
        `ARG FMT_BASE=node:24@${digest}\nFROM \${FMT_BASE}\n`,
      );
      await writeFile(
        join(buildFixture, "ci", "gitctx", "Dockerfile"),
        `ARG GITCTX_BASE=node:24@${digest}\nFROM \${GITCTX_BASE}\n`,
      );
      await writeFile(
        join(buildFixture, ".github", "workflows", "cd-and-ctx.yml"),
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
          "          sh -c 'docker build -f cd.recipe .'",
          "      - run: |",
          "          BASE=ubuntu:24.04",
          "          docker build --build-arg BASE -f ci/arg-local.recipe .",
          `          BASE=node:24@${digest}`,
          "          BASE=redis:7 docker build --build-arg BASE -f ci/arg-env.recipe .",
          `      - run: docker build --build-context maybectx=docker-image://node:24@${digest} -f ci/shared.recipe .`,
          "      - run: docker build -f ci/shared.recipe .",
          "      - shell: pwsh",
          "        run: docker build -f ci\\win\\win.recipe .",
          "      - run: |",
          "          docker build -f - --build-arg STDIN_BASE=fedora:41 . < ci/stdin.recipe",
          "          <ci/stdin-attached.recipe docker build -",
          "          docker build -f - . < ci/missing.recipe",
          "          docker build -f sub/Dockerfile - < ci/context.tar.gz",
          "          docker build - < ci/context.tar.gz",
          "          docker buildx --builder ci build --build-arg EMPTY_BASE=golang:1.24 -f ci/arg-empty.recipe .",
          "          podman build --build-arg PODMAN_BASE=postgres:17 ci/dual",
          "          buildah bud --build-arg BUILDAH_BASE=nginx:1.27 ci/dual",
          "          docker build --build-arg DOCKER_BASE=python:3.13 ci/dual",
          "          docker build -tfrontend --build-arg TAG_BASE=erlang:27 ci/tag-opt",
          "          pushd ci/cmdsub",
          "          IMAGE_ID=$(docker build -q -f sub.recipe .)",
          "          popd",
          "          docker build -f ci/popd.recipe .",
          "          docker build -f=ci/short-eq.recipe .",
          "          env -C ci docker build -f env-chdir.recipe .",
          "          docker builder build -f ci/builder-alias.recipe .",
          "          podman build --format docker --build-arg FMT_BASE=mariadb:11 ci/podman-fmt",
          "          docker build --file ci/generated.Dockerfile .",
          "      - uses: docker/build-push-action@1111111111111111111111111111111111111111 # v6",
          "        with:",
          "          file: ${{ github.workspace }}/ci/workspace.recipe",
          "      - uses: docker/build-push-action@1111111111111111111111111111111111111111 # v6",
          "        with:",
          "          file: ci/action-generated.Dockerfile",
          "      - uses: docker/build-push-action@1111111111111111111111111111111111111111 # v6",
          "        with:",
          "          context: '{{defaultContext}}:ci/gitctx'",
          "          build-args: GITCTX_BASE=mongo:8",
          "      - uses: docker/build-push-action@1111111111111111111111111111111111111111 # v6",
          "        with:",
          "          context: https://github.com/example/remote.git#main",
          "      - uses: docker/build-push-action@1111111111111111111111111111111111111111 # v6",
          "        with:",
          `          build-contexts: rootctx=docker-image://node:24@${digest}`,
          "      - uses: docker/build-push-action@1111111111111111111111111111111111111111 # v6",
          "",
        ].join("\n"),
      );
      const buildResult = checkWorkflowPins(buildFixture);
      expect(buildResult.problems).toEqual([
        ".github/workflows/cd-and-ctx.yml:24: stdin containerfile input ci/missing.recipe cannot be verified statically",
        ".github/workflows/cd-and-ctx.yml:25: stdin build context archive cannot be verified statically",
        ".github/workflows/cd-and-ctx.yml:26: stdin build context archive ci/context.tar.gz cannot be verified statically",
        ".github/workflows/cd-and-ctx.yml:40: build file ci/generated.Dockerfile cannot be verified statically",
        ".github/workflows/cd-and-ctx.yml:46: build file ci/action-generated.Dockerfile cannot be verified statically",
        ".github/workflows/cd-and-ctx.yml:53: build context https://github.com/example/remote.git#main cannot be verified statically",
        "Dockerfile:1: rootctx is not pinned to a sha256 digest",
        "ci/builder-alias.recipe:1: swift:6.0 is not pinned to a sha256 digest",
        "ci/cmdsub/sub.recipe:1: ruby:3.4 is not pinned to a sha256 digest",
        "ci/env-chdir.recipe:1: lua:5.4 is not pinned to a sha256 digest",
        "ci/nested-b/cd.recipe:1: busybox:1.37 is not pinned to a sha256 digest",
        "ci/popd.recipe:1: perl:5.40 is not pinned to a sha256 digest",
        "ci/shared.recipe:1: maybectx is not pinned to a sha256 digest",
        "ci/short-eq.recipe:1: elixir:1.18 is not pinned to a sha256 digest",
        "ci/stdin-attached.recipe:1: debian:12 is not pinned to a sha256 digest",
        "ci/win/win.recipe:1: alpine:3.20 is not pinned to a sha256 digest",
        "ci/workspace.recipe:1: zig:0.14 is not pinned to a sha256 digest",
        "ci/arg-env.recipe:2: redis:7 is not pinned to a sha256 digest",
        "ci/stdin.recipe:2: fedora:41 is not pinned to a sha256 digest",
        "ci/arg-empty.recipe:2: golang:1.24 is not pinned to a sha256 digest",
        "ci/dual/Containerfile:3: postgres:17 is not pinned to a sha256 digest",
        "ci/dual/Containerfile:4: nginx:1.27 is not pinned to a sha256 digest",
        "ci/dual/Dockerfile:2: python:3.13 is not pinned to a sha256 digest",
        "ci/tag-opt/Dockerfile:2: erlang:27 is not pinned to a sha256 digest",
        "ci/podman-fmt/Containerfile:2: mariadb:11 is not pinned to a sha256 digest",
        "ci/gitctx/Dockerfile:2: mongo:8 is not pinned to a sha256 digest",
      ]);
    } finally {
      await rm(buildFixture, { recursive: true, force: true });
    }
    // Symlink boundary assertions are isolated so Windows checkouts without
    // symlink privileges still run every non-symlink contract assertion above.
    const symlinkFixture = await mkdtemp(join(tmpdir(), "palamedes-pins-symlink-"));
    const outsideDir = await mkdtemp(join(tmpdir(), "palamedes-pins-outside-"));
    try {
      await mkdir(join(symlinkFixture, ".github", "workflows"), { recursive: true });
      await mkdir(join(symlinkFixture, "ci"), { recursive: true });
      await writeFile(join(outsideDir, "escaped.recipe"), "FROM alpine:3.20\n");
      await writeFile(join(symlinkFixture, "ci", "target.recipe"), "FROM alpine:3.20\n");
      let symlinksCreated = false;
      try {
        await symlink(outsideDir, join(symlinkFixture, "ci", "escaped-link"));
        await symlink("ci/target.recipe", join(symlinkFixture, "Dockerfile"));
        symlinksCreated = true;
      } catch (error) {
        if (process.platform !== "win32" || (error?.code !== "EPERM" && error?.code !== "EACCES")) {
          throw error;
        }
      }
      if (symlinksCreated) {
        await writeFile(
          join(symlinkFixture, ".github", "workflows", "symlink.yml"),
          [
            "jobs:",
            "  build:",
            "    runs-on: ubuntu-24.04",
            "    steps:",
            "      - run: docker build -f ci/escaped-link/escaped.recipe .",
            "",
          ].join("\n"),
        );
        const symlinkResult = checkWorkflowPins(symlinkFixture);
        expect(symlinkResult.problems).toEqual([
          "ci/escaped-link/escaped.recipe:1: symlink target escapes repository root and cannot be verified",
          "ci/target.recipe:1: alpine:3.20 is not pinned to a sha256 digest",
        ]);
      }
    } finally {
      await rm(symlinkFixture, { recursive: true, force: true });
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("resolves composite actions, local reusable workflows, and checkout boundaries", async () => {
    const digest = `sha256:${"a".repeat(64)}`;
    // Composite-action call-site input & default resolution, Git build context
    // explicit Dockerfile resolution (`{{defaultContext}}:subdir` + `file:`),
    // real builder defaults with fail-closed missing-default reporting, and
    // BuildKit automatic platform arguments (`TARGETARCH`, `TARGETPLATFORM`, etc.).
    const multiarchDockerfile = [
      `FROM alpine:3.20@${digest} AS build-amd64`,
      `FROM alpine:3.20@${digest} AS build-arm64`,
      "FROM build-${TARGETARCH} AS final",
      "ARG TARGETARCH",
      "COPY --from=build-${TARGETARCH} /out /out",
      "",
    ].join("\n");
    expect(unpinnedContainerfileReferences(multiarchDockerfile)).toEqual([]);
    expect(
      unpinnedContainerfileReferences(multiarchDockerfile, "<memory>", {
        platforms: ["linux/amd64", "linux/arm64"],
      }),
    ).toEqual([]);
    expect(
      unpinnedContainerfileReferences(multiarchDockerfile, "<memory>", {
        platforms: ["linux/amd64", "linux/s390x"],
      }),
    ).toEqual([
      "<memory>:3: build-s390x is not pinned to a sha256 digest",
      "<memory>:5: build-s390x is not pinned to a sha256 digest",
    ]);
    const compositeAndContextFixture = await mkdtemp(join(tmpdir(), "palamedes-pins-r30-"));
    try {
      await mkdir(join(compositeAndContextFixture, ".github", "workflows"), { recursive: true });
      await mkdir(join(compositeAndContextFixture, ".github", "actions", "pull-image"), {
        recursive: true,
      });
      await mkdir(join(compositeAndContextFixture, ".github", "actions", "pull-pinned-default"), {
        recursive: true,
      });
      await mkdir(join(compositeAndContextFixture, "service"), { recursive: true });
      await mkdir(join(compositeAndContextFixture, "service-bad"), { recursive: true });
      await mkdir(join(compositeAndContextFixture, "ci", "only-containerfile"), {
        recursive: true,
      });
      await mkdir(join(compositeAndContextFixture, "ci", "empty-dir"), { recursive: true });
      await mkdir(join(compositeAndContextFixture, "ci", "multiarch"), { recursive: true });
      await writeFile(
        join(compositeAndContextFixture, ".github", "actions", "pull-image", "action.yml"),
        [
          "name: Pull image",
          "inputs:",
          "  image:",
          "    required: true",
          "  fallback:",
          "    default: busybox:1.37",
          "runs:",
          "  using: composite",
          "  steps:",
          "    - shell: bash",
          "      run: |",
          "        docker pull ${{ inputs.image }}",
          "        docker pull ${{ inputs.fallback }}",
          "",
        ].join("\n"),
      );
      await writeFile(
        join(compositeAndContextFixture, ".github", "actions", "pull-pinned-default", "action.yml"),
        [
          "name: Pull pinned default",
          "inputs:",
          "  image:",
          `    default: node:24@${digest}`,
          "runs:",
          "  using: composite",
          "  steps:",
          "    - shell: bash",
          "      run: docker pull ${{ inputs.image }}",
          "",
        ].join("\n"),
      );
      await writeFile(join(compositeAndContextFixture, "Buildfile"), `FROM node:24@${digest}\n`);
      await writeFile(
        join(compositeAndContextFixture, "service", "Buildfile"),
        `FROM node:24@${digest}\n`,
      );
      await writeFile(
        join(compositeAndContextFixture, "service-bad", "Buildfile"),
        "FROM ruby:3.4\n",
      );
      await writeFile(
        join(compositeAndContextFixture, "ci", "only-containerfile", "Containerfile"),
        `FROM node:24@${digest}\n`,
      );
      await writeFile(
        join(compositeAndContextFixture, "ci", "multiarch", "Dockerfile"),
        "FROM myrepo/app:${TARGETARCH}\n",
      );
      await writeFile(
        join(compositeAndContextFixture, ".github", "workflows", "verify.yml"),
        [
          "jobs:",
          "  test:",
          "    runs-on: ubuntu-24.04",
          "    steps:",
          "      - uses: ./.github/actions/pull-image",
          "        with:",
          "          image: alpine:3.20",
          "      - uses: ./.github/actions/pull-pinned-default",
          "      - uses: ./.github/actions/pull-pinned-default",
          "        with:",
          "          image: redis:7",
          "      - uses: docker/build-push-action@1111111111111111111111111111111111111111 # v6",
          "        with:",
          "          context: '{{defaultContext}}:service'",
          "          file: Buildfile",
          "      - uses: docker/build-push-action@1111111111111111111111111111111111111111 # v6",
          "        with:",
          "          context: '{{defaultContext}}:service-bad'",
          "          file: Buildfile",
          "      - uses: docker/build-push-action@1111111111111111111111111111111111111111 # v6",
          "        with:",
          "          context: ./service-bad",
          "          file: Buildfile",
          "      - uses: docker/build-push-action@1111111111111111111111111111111111111111 # v6",
          "        with:",
          "          context: ci/only-containerfile",
          "      - uses: docker/build-push-action@1111111111111111111111111111111111111111 # v6",
          "        with:",
          "          context: ci/multiarch",
          "          platforms: linux/amd64,linux/arm64",
          "      - run: |",
          "          docker build ci/only-containerfile",
          "          podman build ci/only-containerfile",
          "          docker build ci/empty-dir",
          "          podman build ci/empty-dir",
          "",
        ].join("\n"),
      );
      const r30Result = checkWorkflowPins(compositeAndContextFixture);
      expect(r30Result.problems).toEqual([
        ".github/actions/pull-image/action.yml:12: alpine:3.20 is not pinned to a sha256 digest",
        ".github/actions/pull-image/action.yml:13: busybox:1.37 is not pinned to a sha256 digest",
        ".github/actions/pull-pinned-default/action.yml:9: redis:7 is not pinned to a sha256 digest",
        ".github/workflows/verify.yml:24: default build file ci/only-containerfile/Dockerfile cannot be verified statically",
        ".github/workflows/verify.yml:32: default build file ci/only-containerfile/Dockerfile cannot be verified statically",
        ".github/workflows/verify.yml:34: default build file ci/empty-dir/Dockerfile cannot be verified statically",
        ".github/workflows/verify.yml:35: default build file ci/empty-dir/Containerfile cannot be verified statically",
        "service-bad/Buildfile:1: ruby:3.4 is not pinned to a sha256 digest",
        "ci/multiarch/Dockerfile:1: myrepo/app:amd64 is not pinned to a sha256 digest",
        "ci/multiarch/Dockerfile:1: myrepo/app:arm64 is not pinned to a sha256 digest",
      ]);
    } finally {
      await rm(compositeAndContextFixture, { recursive: true, force: true });
    }
    // Image-backed `--mount type=image` sources in `docker`/`podman` `run` and
    // `create` are validated while bind/volume mounts are ignored; local actions
    // outside `.github/actions` have their nested `uses:` pins checked, their
    // `GITHUB_ENV` writes propagate to callers, `actions/checkout` `path:`
    // translates workspace-relative build paths, and Docker's lowercase
    // `dockerfile` fallback is honored.
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "steps:",
          `  - run: docker run --mount type=image,source=alpine:3.20,destination=/mnt node:24@${digest}`,
          `  - run: docker create --mount=type=image,src=busybox:1.37,dst=/mnt node:24@${digest}`,
          `  - run: podman run --mount type=image,src=node:24@${digest},target=/mnt node:24@${digest}`,
          `  - run: docker run --mount type=bind,source=./local,target=/mnt --mount type=volume,source=myvol,target=/data node:24@${digest}`,
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "<memory>:2: alpine:3.20 is not pinned to a sha256 digest",
      "<memory>:3: busybox:1.37 is not pinned to a sha256 digest",
    ]);
    const r31Fixture = await mkdtemp(join(tmpdir(), "palamedes-pins-r31-"));
    try {
      await mkdir(join(r31Fixture, ".github", "workflows"), { recursive: true });
      await mkdir(join(r31Fixture, ".github", "actions", "set-img"), { recursive: true });
      await mkdir(join(r31Fixture, "tools", "docker-step"), { recursive: true });
      await mkdir(join(r31Fixture, "ci", "lower-ok"), { recursive: true });
      await mkdir(join(r31Fixture, "ci", "lower-bad"), { recursive: true });
      await writeFile(join(r31Fixture, "Containerfile"), `FROM node:24@${digest}\n`);
      await writeFile(join(r31Fixture, "bad.recipe"), "FROM perl:5.40\n");
      await writeFile(join(r31Fixture, "ci", "lower-ok", "dockerfile"), `FROM node:24@${digest}\n`);
      await writeFile(
        join(r31Fixture, "ci", "lower-bad", "dockerfile"),
        `ARG LOWER_BASE=node:24@${digest}\nFROM \${LOWER_BASE}\n`,
      );
      await writeFile(
        join(r31Fixture, "tools", "docker-step", "action.yml"),
        [
          "name: External local action",
          "runs:",
          "  using: composite",
          "  steps:",
          "    - uses: docker://alpine:3.20",
          "    - uses: actions/checkout@v4",
          "",
        ].join("\n"),
      );
      await writeFile(
        join(r31Fixture, ".github", "actions", "set-img", "action.yml"),
        [
          "name: Set image env",
          "description: Emits an image reference into GITHUB_ENV",
          "runs:",
          "  using: composite",
          "  steps:",
          "    - name: Emit image",
          "      shell: bash",
          '      run: echo "RESOLVED_IMG=redis:7" >> "$GITHUB_ENV"',
          "",
        ].join("\n"),
      );
      await writeFile(
        join(r31Fixture, ".github", "workflows", "checkout-and-actions.yml"),
        [
          "jobs:",
          "  default-checkout:",
          "    runs-on: ubuntu-24.04",
          "    steps:",
          "      - uses: ./tools/docker-step",
          "      - uses: ./.github/actions/set-img",
          '      - run: docker pull "$RESOLVED_IMG"',
          "      - run: |",
          "          docker build ci/lower-ok",
          "          docker build --build-arg LOWER_BASE=elixir:1.18 ci/lower-bad",
          "      - uses: docker/build-push-action@1111111111111111111111111111111111111111 # v6",
          "        with:",
          "          context: ci/lower-ok",
          "  subdir-checkout:",
          "    runs-on: ubuntu-24.04",
          "    steps:",
          "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7",
          "        with:",
          "          path: src",
          "      - run: |",
          "          docker build -f src/Containerfile src",
          "          docker build -f src/bad.recipe src",
          "          docker build -f Containerfile .",
          "      - working-directory: src",
          "        run: docker build -f Containerfile .",
          "      - uses: docker/build-push-action@1111111111111111111111111111111111111111 # v6",
          "        with:",
          "          context: src",
          "          file: src/Containerfile",
          "",
        ].join("\n"),
      );
      const r31Result = checkWorkflowPins(r31Fixture);
      expect(r31Result.problems).toEqual([
        "tools/docker-step/action.yml:5: docker://alpine:3.20 is not pinned to a sha256 digest",
        "tools/docker-step/action.yml:6: actions/checkout@v4 is not pinned to a full commit SHA",
        ".github/workflows/checkout-and-actions.yml:6: redis:7 is not pinned to a sha256 digest",
        ".github/workflows/checkout-and-actions.yml:23: build file Containerfile cannot be verified statically",
        "bad.recipe:1: perl:5.40 is not pinned to a sha256 digest",
        "ci/lower-bad/dockerfile:2: elixir:1.18 is not pinned to a sha256 digest",
      ]);
    } finally {
      await rm(r31Fixture, { recursive: true, force: true });
    }
    // Double-quoted `sh -c "..."` expands unescaped variables in the parent
    // shell before command-local prefix assignments take effect while preserving
    // escaped `\$VAR` for the child shell; `actions/checkout` with a different
    // `ref:` does not map to the current working tree; and local reusable
    // workflows resolve call-site `with:` inputs and `workflow_call` defaults.
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "steps:",
          "  - run: |",
          `      IMAGE=node:24@${digest}`,
          '      IMAGE=busybox sh -c "docker pull $IMAGE"',
          '      IMAGE=alpine:3.20 sh -c "docker pull \\$IMAGE"',
          "      LOCAL=redis:7",
          '      sh -c "docker pull $LOCAL"',
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "<memory>:5: alpine:3.20 is not pinned to a sha256 digest",
      "<memory>:7: redis:7 is not pinned to a sha256 digest",
    ]);
    const r32Fixture = await mkdtemp(join(tmpdir(), "palamedes-pins-r32-"));
    try {
      await mkdir(join(r32Fixture, ".github", "workflows"), { recursive: true });
      await writeFile(join(r32Fixture, "Containerfile"), `FROM node:24@${digest}\n`);
      await writeFile(
        join(r32Fixture, ".github", "workflows", "reusable.yml"),
        [
          "on:",
          "  workflow_call:",
          "    inputs:",
          "      image:",
          "        required: true",
          "        type: string",
          "      fallback:",
          "        type: string",
          "        default: busybox:1.37",
          "jobs:",
          "  run:",
          "    runs-on: ubuntu-24.04",
          "    container: ${{ inputs.image }}",
          "    steps:",
          "      - run: docker pull ${{ inputs.fallback }}",
          "",
        ].join("\n"),
      );
      await writeFile(
        join(r32Fixture, ".github", "workflows", "caller-and-ref.yml"),
        [
          "jobs:",
          "  call-reusable:",
          "    uses: ./.github/workflows/reusable.yml",
          "    with:",
          "      image: alpine:3.20",
          "  tag-checkout:",
          "    runs-on: ubuntu-24.04",
          "    steps:",
          "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7",
          "        with:",
          "          ref: v1.0.0",
          "      - run: docker build -f Containerfile .",
          "  mixed-checkout:",
          "    runs-on: ubuntu-24.04",
          "    steps:",
          "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7",
          "        with:",
          "          ref: ${{ github.sha }}",
          "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7",
          "        with:",
          "          ref: v1.0.0",
          "          path: release",
          "      - run: |",
          "          docker build -f Containerfile .",
          "          docker build -f release/Containerfile release",
          "",
        ].join("\n"),
      );
      const r32Result = checkWorkflowPins(r32Fixture);
      expect(r32Result.problems).toEqual([
        ".github/workflows/reusable.yml:13: alpine:3.20 is not pinned to a sha256 digest",
        ".github/workflows/reusable.yml:15: busybox:1.37 is not pinned to a sha256 digest",
        ".github/workflows/caller-and-ref.yml:12: build file Containerfile cannot be verified statically",
        ".github/workflows/caller-and-ref.yml:25: build file release/Containerfile cannot be verified statically",
      ]);
    } finally {
      await rm(r32Fixture, { recursive: true, force: true });
    }
    // `workflow_dispatch` input defaults (including dual-trigger workflows),
    // memoized YAML alias sharing during input substitution, dead-step skipping
    // when no runner matches `if:`, commit-only checkout identity (`github.head_ref`
    // fails closed), unverifiable local action reporting, and fail-closed
    // reusable-workflow nesting depth limits.
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "on:",
          "  workflow_call:",
          "    inputs:",
          "      image:",
          `        default: node:24@${digest}`,
          "  workflow_dispatch:",
          "    inputs:",
          "      image:",
          "        default: busybox:1.37",
          "jobs:",
          "  run:",
          "    runs-on: ubuntu-24.04",
          "    container: ${{ inputs.image }}",
          "",
        ].join("\n"),
      ),
    ).toEqual(["<memory>:13: busybox:1.37 is not pinned to a sha256 digest"]);
    const aliasChainLines = [
      "on:",
      "  workflow_dispatch:",
      "    inputs:",
      "      image:",
      "        default: alpine:3.20",
      "x-a0: &a0",
      "  img: ${{ inputs.image }}",
      ...Array.from(
        { length: 12 },
        (_, idx) => `x-a${idx + 1}: &a${idx + 1}\n  l: *a${idx}\n  r: *a${idx}`,
      ),
      "jobs:",
      "  shared:",
      "    runs-on: ubuntu-24.04",
      "    container: ${{ inputs.image }}",
      "    steps:",
      "      - if: runner.os == 'Windows'",
      "        run: docker pull redis:7",
      "",
    ].join("\n");
    expect(unpinnedWorkflowContainerReferences(aliasChainLines)).toEqual([
      "<memory>:47: alpine:3.20 is not pinned to a sha256 digest",
    ]);
    const r33Fixture = await mkdtemp(join(tmpdir(), "palamedes-pins-r33-"));
    try {
      await mkdir(join(r33Fixture, ".github", "workflows"), { recursive: true });
      await writeFile(join(r33Fixture, "Containerfile"), `FROM node:24@${digest}\n`);
      for (let level = 0; level <= 10; level += 1) {
        const content =
          level < 10
            ? [
                "on:",
                "  workflow_call:",
                "jobs:",
                "  next:",
                `    uses: ./.github/workflows/depth-${level + 1}.yml`,
                "",
              ].join("\n")
            : [
                "on:",
                "  workflow_call:",
                "jobs:",
                "  leaf:",
                "    runs-on: ubuntu-24.04",
                "    steps:",
                "      - run: echo ok",
                "",
              ].join("\n");
        await writeFile(join(r33Fixture, ".github", "workflows", `depth-${level}.yml`), content);
      }
      await writeFile(
        join(r33Fixture, ".github", "workflows", "checkout-and-runner.yml"),
        [
          "jobs:",
          "  head-ref-checkout:",
          "    runs-on: ubuntu-24.04",
          "    steps:",
          "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7",
          "        with:",
          "          ref: ${{ github.head_ref }}",
          "      - run: docker build -f Containerfile .",
          "      - uses: ./unverifiable-action",
          "  linux-only:",
          "    runs-on: ubuntu-24.04",
          "    steps:",
          "      - if: runner.os == 'Windows'",
          "        run: docker build -f windows-only.Dockerfile .",
          "",
        ].join("\n"),
      );
      const r33Result = checkWorkflowPins(r33Fixture);
      expect(r33Result.problems).toEqual([
        ".github/workflows/checkout-and-runner.yml:8: build file Containerfile cannot be verified statically",
        ".github/workflows/checkout-and-runner.yml:9: local action ./unverifiable-action cannot be verified statically",
        ".github/workflows/depth-9.yml:5: local reusable workflow ./.github/workflows/depth-10.yml exceeds maximum nesting depth (10) and cannot be verified",
      ]);
    } finally {
      await rm(r33Fixture, { recursive: true, force: true });
    }
    // Podman/Buildah `--from` and `--sbom-scanner-image` image overrides,
    // deferring required composite-action inputs to their callers, resolving
    // `GITHUB_ACTION_PATH` / `github.action_path`, and Dockerfile-only local actions.
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "steps:",
          "  - run: |",
          "      podman build --from alpine:3.20 .",
          `      podman build --from scratch --sbom-scanner-image=syft:1.0 .`,
          `      buildah bud --from node:24@${digest} --sbom-scanner-image syft:1.0@${digest} .`,
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "<memory>:3: alpine:3.20 is not pinned to a sha256 digest",
      "<memory>:4: syft:1.0 is not pinned to a sha256 digest",
    ]);
    const r34Fixture = await mkdtemp(join(tmpdir(), "palamedes-pins-r34-"));
    try {
      await mkdir(join(r34Fixture, ".github", "workflows"), { recursive: true });
      await mkdir(join(r34Fixture, ".github", "actions", "build-ctx"), { recursive: true });
      await mkdir(join(r34Fixture, ".github", "actions", "self-build"), { recursive: true });
      await mkdir(join(r34Fixture, "service"), { recursive: true });
      await mkdir(join(r34Fixture, "docker-only-action"), { recursive: true });
      await writeFile(join(r34Fixture, "service", "Dockerfile"), "FROM scratch\n");
      await writeFile(
        join(r34Fixture, ".github", "actions", "build-ctx", "action.yml"),
        [
          "inputs:",
          "  context:",
          "    required: true",
          "runs:",
          "  using: composite",
          "  steps:",
          "    - shell: bash",
          '      run: docker build "${{ inputs.context }}"',
          "",
        ].join("\n"),
      );
      await writeFile(
        join(r34Fixture, ".github", "actions", "self-build", "Dockerfile"),
        `FROM node:24@${digest}\n`,
      );
      await writeFile(
        join(r34Fixture, ".github", "actions", "self-build", "action.yml"),
        [
          "runs:",
          "  using: composite",
          "  steps:",
          "    - shell: bash",
          '      run: docker build "$GITHUB_ACTION_PATH"',
          "    - shell: bash",
          '      run: docker build -f "${{ github.action_path }}/Dockerfile" "$GITHUB_ACTION_PATH"',
          "",
        ].join("\n"),
      );
      await writeFile(
        join(r34Fixture, "docker-only-action", "Dockerfile"),
        `FROM node:24@${digest}\n`,
      );
      await writeFile(
        join(r34Fixture, ".github", "workflows", "ci.yml"),
        [
          "jobs:",
          "  build:",
          "    runs-on: ubuntu-24.04",
          "    steps:",
          "      - uses: ./.github/actions/build-ctx",
          "        with:",
          "          context: service",
          "      - uses: ./.github/actions/self-build",
          "      - uses: ./docker-only-action",
          "",
        ].join("\n"),
      );
      const r34Result = checkWorkflowPins(r34Fixture);
      expect(r34Result.problems).toEqual([]);
    } finally {
      await rm(r34Fixture, { recursive: true, force: true });
    }
    // `workflow_dispatch` choice options beyond the default, missing Docker
    // action Dockerfiles (`runs.image`), and nested shell depth limits all fail closed.
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "on:",
          "  workflow_dispatch:",
          "    inputs:",
          "      image:",
          "        type: choice",
          `        default: node:24@${digest}`,
          "        options:",
          `          - node:24@${digest}`,
          "          - alpine:3.20",
          "jobs:",
          "  run:",
          "    runs-on: ubuntu-24.04",
          "    container: ${{ inputs.image }}",
          "",
        ].join("\n"),
      ),
    ).toEqual(["<memory>:13: alpine:3.20 is not pinned to a sha256 digest"]);
    const deepNestedShell = Array.from({ length: 10 }).reduce(
      (inner) => `sh -c '${inner.replaceAll("'", "'\"'\"'")}'`,
      "docker pull alpine:3.20",
    );
    expect(unpinnedWorkflowContainerReferences(`steps:\n  - run: ${deepNestedShell}\n`)).toEqual([
      "<memory>:2: nested shell inspection exceeds maximum depth (8) and cannot be verified",
    ]);
    const r35Fixture = await mkdtemp(join(tmpdir(), "palamedes-pins-r35-"));
    try {
      await mkdir(join(r35Fixture, ".github", "actions", "missing-docker"), { recursive: true });
      await writeFile(
        join(r35Fixture, ".github", "actions", "missing-docker", "action.yml"),
        "name: Missing Docker\nruns:\n  using: docker\n  image: ./deleted.Dockerfile\n",
      );
      const r35Result = checkWorkflowPins(r35Fixture);
      expect(r35Result.problems).toEqual([
        ".github/actions/missing-docker/action.yml:4: build file ./deleted.Dockerfile cannot be verified statically",
      ]);
    } finally {
      await rm(r35Fixture, { recursive: true, force: true });
    }
  });

  it("evaluates workflow_dispatch inputs, event guards, SBOM attestations, and BuildKit/QEMU actions", async () => {
    const digest = `sha256:${"a".repeat(64)}`;
    // Unresolved `working-directory` stays unknown instead of falling back to
    // the repo root; non-dispatch triggers (`schedule` + `workflow_dispatch`)
    // evaluate absent inputs; `github.event.inputs.*` resolves dispatch choices;
    // BuildKit SBOM generator images (`--sbom`, `--attest`, `sbom:`, `attests:`)
    // are validated; and shell `${VAR:=default}` / `${VAR=default}` propagate
    // assignments to subsequent commands.
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "on:",
          "  schedule:",
          '    - cron: "0 0 * * *"',
          "  workflow_dispatch:",
          "    inputs:",
          "      image:",
          "        type: choice",
          `        default: node:24@${digest}`,
          "        options:",
          `          - node:24@${digest}`,
          "          - alpine:3.20",
          "jobs:",
          "  dispatch-and-schedule:",
          "    runs-on: ubuntu-24.04",
          "    container: ${{ github.event.inputs.image }}",
          "    steps:",
          "      - env:",
          "          IMAGE: ${{ inputs.image }}",
          '        run: docker pull "${IMAGE:-busybox:1.37}"',
          "      - run: |",
          '          : "${ASSIGNED_IMG:=redis:7}"',
          '          docker pull "$ASSIGNED_IMG"',
          '          EMPTY_IMG=""',
          '          : "${EMPTY_IMG=nginx:1.27}"',
          '          docker pull "$EMPTY_IMG"',
          '          : "${UNSET_EQ=postgres:17}"',
          '          docker pull "$UNSET_EQ"',
          "          docker buildx build --sbom=generator=docker/scout-sbom-indexer:latest .",
          "          docker buildx build --attest type=sbom,generator=my/scanner:1.0 .",
          `          docker buildx build --attest type=sbom,generator=my/scanner:1.0@${digest} .`,
          "      - uses: docker/build-push-action@1111111111111111111111111111111111111111 # v6",
          "        with:",
          "          sbom: generator=action/scanner:2.0",
          "          attests: |",
          "            type=provenance,mode=max",
          "            type=sbom,generator=action/attest-scanner:3.0",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "<memory>:21: redis:7 is not pinned to a sha256 digest",
      "<memory>:26: postgres:17 is not pinned to a sha256 digest",
      "<memory>:28: docker/scout-sbom-indexer:latest is not pinned to a sha256 digest",
      "<memory>:29: my/scanner:1.0 is not pinned to a sha256 digest",
      "<memory>:33: action/scanner:2.0 is not pinned to a sha256 digest",
      "<memory>:35: action/attest-scanner:3.0 is not pinned to a sha256 digest",
      "<memory>:15: alpine:3.20 is not pinned to a sha256 digest",
      "<memory>:18: alpine:3.20 is not pinned to a sha256 digest",
      "<memory>:19: busybox:1.37 is not pinned to a sha256 digest",
    ]);
    const r36Fixture = await mkdtemp(join(tmpdir(), "palamedes-pins-r36-"));
    try {
      await mkdir(join(r36Fixture, ".github", "workflows"), { recursive: true });
      await writeFile(join(r36Fixture, "release.recipe"), `FROM node:24@${digest}\n`);
      await writeFile(
        join(r36Fixture, ".github", "workflows", "unknown-wd.yml"),
        [
          "jobs:",
          "  build:",
          "    runs-on: ubuntu-24.04",
          "    steps:",
          "      - working-directory: ${{ needs.prepare.outputs.directory }}",
          "        run: docker build -f release.recipe .",
          "      - working-directory: ${{ needs.prepare.outputs.directory }}",
          "        run: docker build -f ${{ github.workspace }}/release.recipe ${{ github.workspace }}",
          "",
        ].join("\n"),
      );
      const r36Result = checkWorkflowPins(r36Fixture);
      expect(r36Result.problems).toEqual([
        ".github/workflows/unknown-wd.yml:6: build file release.recipe cannot be verified statically",
      ]);
    } finally {
      await rm(r36Fixture, { recursive: true, force: true });
    }
    // Enabled SBOM attestations without an explicit digest-pinned generator fail
    // closed; unrelated multi-choice `workflow_dispatch` inputs do not explode
    // combinations; Podman `--rootfs` treats the operand as a local directory
    // while still checking `--mount type=image`; and hidden `.devcontainer`
    // Dockerfiles are discovered.
    const seventeenChoices = Array.from({ length: 17 }, (_, idx) => `          - opt-${idx}`).join(
      "\n",
    );
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "on:",
          "  workflow_dispatch:",
          "    inputs:",
          "      a:",
          "        type: choice",
          "        default: opt-0",
          "        options:",
          seventeenChoices,
          "      b:",
          "        type: choice",
          "        default: opt-0",
          "        options:",
          seventeenChoices,
          "jobs:",
          "  echo-only:",
          "    runs-on: ubuntu-24.04",
          "    steps:",
          '      - run: echo "${{ inputs.a }} ${{ inputs.b }}"',
          "",
        ].join("\n"),
      ),
    ).toEqual([]);
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "steps:",
          "  - run: |",
          "      docker buildx build --sbom=true .",
          "      docker buildx build --sbom=false .",
          "      docker buildx build --attest type=sbom .",
          "      docker buildx build --attest type=sbom,disabled=true .",
          "      podman run --rm --rootfs ./rootfs /bin/true",
          "      podman run --rm --rootfs --mount type=image,source=alpine:3.20,destination=/mnt ./rootfs /bin/true",
          "  - uses: docker/build-push-action@1111111111111111111111111111111111111111 # v6",
          "    with:",
          "      sbom: true",
          "      attests: type=sbom",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "<memory>:3: BuildKit SBOM attestation uses unpinned default scanner image (specify generator=...@sha256:...)",
      "<memory>:5: BuildKit SBOM attestation uses unpinned default scanner image (specify generator=...@sha256:...)",
      "<memory>:8: alpine:3.20 is not pinned to a sha256 digest",
      "<memory>:11: BuildKit SBOM attestation uses unpinned default scanner image (specify generator=...@sha256:...)",
      "<memory>:12: BuildKit SBOM attestation uses unpinned default scanner image (specify generator=...@sha256:...)",
    ]);
    const r37Fixture = await mkdtemp(join(tmpdir(), "palamedes-pins-r37-"));
    try {
      await mkdir(join(r37Fixture, ".devcontainer"), { recursive: true });
      await writeFile(join(r37Fixture, ".devcontainer", "Dockerfile"), "FROM alpine:3.20\n");
      const r37Result = checkWorkflowPins(r37Fixture);
      expect(r37Result.problems).toEqual([
        ".devcontainer/Dockerfile:1: alpine:3.20 is not pinned to a sha256 digest",
      ]);
    } finally {
      await rm(r37Fixture, { recursive: true, force: true });
    }
    // `docker/setup-qemu-action` requires a digest-pinned image; checkout +
    // workflow-level `env` choices unused by container steps do not explode;
    // Podman `--sbom` presets pair with `--sbom-scanner-image` instead of
    // BuildKit `generator=`; non-manifest YAML files beside `action.yml` are
    // ignored; and repeated matrix calls to a local reusable workflow are memoized.
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "on:",
          "  workflow_dispatch:",
          "    inputs:",
          "      a:",
          "        type: choice",
          "        default: opt-0",
          "        options:",
          seventeenChoices,
          "      b:",
          "        type: choice",
          "        default: opt-0",
          "        options:",
          seventeenChoices,
          "env:",
          "  A: ${{ inputs.a }}",
          "  B: ${{ inputs.b }}",
          "jobs:",
          "  checkout-and-echo:",
          "    runs-on: ubuntu-24.04",
          "    steps:",
          "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7",
          '      - run: echo "$A $B"',
          "",
        ].join("\n"),
      ),
    ).toEqual([]);
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "steps:",
          "  - uses: docker/setup-qemu-action@1111111111111111111111111111111111111111 # v3",
          "  - uses: docker/setup-qemu-action@1111111111111111111111111111111111111111 # v3",
          "    with:",
          "      image: tonistiigi/binfmt:qemu-v9.2.2",
          "  - uses: docker/setup-qemu-action@1111111111111111111111111111111111111111 # v3",
          "    with:",
          `      image: tonistiigi/binfmt:qemu-v9.2.2@${digest}`,
          "  - run: |",
          `      podman build --sbom syft --sbom-scanner-image syft:1.0@${digest} .`,
          "      podman build --sbom syft .",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "<memory>:2: docker/setup-qemu-action uses unpinned default QEMU image (pin with.image to ...@sha256:...)",
      "<memory>:5: tonistiigi/binfmt:qemu-v9.2.2 is not pinned to a sha256 digest",
      "<memory>:11: podman build --sbom preset uses unpinned default scanner image (pass --sbom-scanner-image ...@sha256:...)",
    ]);
    const r38Fixture = await mkdtemp(join(tmpdir(), "palamedes-pins-r38-"));
    try {
      await mkdir(join(r38Fixture, ".github", "workflows"), { recursive: true });
      await mkdir(join(r38Fixture, ".github", "actions", "deploy"), { recursive: true });
      await writeFile(
        join(r38Fixture, ".github", "actions", "deploy", "action.yml"),
        "name: Deploy\nruns:\n  using: composite\n  steps:\n    - shell: bash\n      run: echo ok\n",
      );
      await writeFile(
        join(r38Fixture, ".github", "actions", "deploy", "k8s-manifests.yml"),
        "---\napiVersion: v1\nkind: ConfigMap\n---\napiVersion: v1\nkind: Service\n",
      );
      await writeFile(
        join(r38Fixture, ".github", "workflows", "leaf.yml"),
        "on:\n  workflow_call:\n    inputs:\n      image:\n        type: string\njobs:\n  run:\n    runs-on: ubuntu-24.04\n    container: ${{ inputs.image }}\n",
      );
      await writeFile(
        join(r38Fixture, ".github", "workflows", "mid.yml"),
        [
          "on:",
          "  workflow_call:",
          "    inputs:",
          "      image:",
          "        type: string",
          "jobs:",
          "  fan:",
          "    strategy:",
          "      matrix:",
          "        slot: [1, 2, 3, 4, 5, 6, 7, 8]",
          "    uses: ./.github/workflows/leaf.yml",
          "    with:",
          "      image: ${{ inputs.image }}",
          "",
        ].join("\n"),
      );
      await writeFile(
        join(r38Fixture, ".github", "workflows", "top.yml"),
        [
          "jobs:",
          "  fan:",
          "    strategy:",
          "      matrix:",
          "        slot: [1, 2, 3, 4, 5, 6, 7, 8]",
          "    uses: ./.github/workflows/mid.yml",
          "    with:",
          "      image: alpine:3.20",
          "",
        ].join("\n"),
      );
      const r38Result = checkWorkflowPins(r38Fixture);
      expect(r38Result.problems).toEqual([
        ".github/workflows/leaf.yml:9: alpine:3.20 is not pinned to a sha256 digest",
      ]);
    } finally {
      await rm(r38Fixture, { recursive: true, force: true });
    }
    // `docker/setup-buildx-action` validates every appended node's BuildKit
    // image; literal image tags with a dynamic registry prefix are caught;
    // absent properties on known matrix rows expand to empty strings in both
    // fields and run scripts; and Docker's `--umask` consumes its value.
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "jobs:",
          "  r39:",
          "    runs-on: ubuntu-24.04",
          "    strategy:",
          "      matrix:",
          "        include:",
          "          - name: pinned",
          `            suffix: "@${digest}"`,
          "          - name: bare",
          "    container: ghcr.io/${{ github.repository_owner }}/runner:latest",
          "    services:",
          "      db:",
          "        image: node:24${{ matrix.suffix }}",
          "    steps:",
          `      - run: docker run --umask 0022 node:24@${digest} node -v`,
          "      - run: docker pull node:24${{ matrix.suffix }}",
          "      - uses: docker/setup-buildx-action@37fe631027851001ddb9b187196cc803df7f5f0e # v4",
          "        with:",
          "          driver-opts: |",
          `            image=moby/buildkit:v0.35.1@${digest}`,
          "          append: |",
          "            - endpoint: ssh://arm-pinned",
          "              driver-opts: |",
          `                image=moby/buildkit:v0.35.1@${digest}`,
          "            - endpoint: ssh://arm-default",
          "            - endpoint: ssh://arm-mutable",
          "              driver-opts: image=moby/buildkit:v0.35.1",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "<memory>:10: ghcr.io/${{ github.repository_owner }}/runner:latest is not pinned to a sha256 digest",
      "<memory>:13: node:24 is not pinned to a sha256 digest",
      "<memory>:16: node:24 is not pinned to a sha256 digest",
      "<memory>:25: docker/setup-buildx-action appended node uses unpinned default BuildKit image (pin driver-opts image=...@sha256:...)",
      "<memory>:27: moby/buildkit:v0.35.1 is not pinned to a sha256 digest",
    ]);
    // Shell image pulls/runs with dynamic registry prefixes still catch literal
    // unpinned tags while allowing opaque local image IDs and dynamic tags; and
    // BuildKit `DetectSyntax` rules honor shebangs, `// syntax=`, and JSON syntax.
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "steps:",
          "  - run: |",
          '      docker pull "$REGISTRY/app:latest"',
          '      docker run --rm "$REGISTRY/app:v1.2" node -v',
          '      docker pull "$REGISTRY/team/worker"',
          '      docker run --rm "$REGISTRY/$IMAGE_NAME" node -v',
          '      docker run --rm "$REGISTRY/team/worker$SUFFIX" node -v',
          '      docker run --rm "$IMAGE_ID" node -v',
          '      docker run --rm "ghcr.io/${{ github.repository_owner }}/app:sha-${{ github.sha }}" node -v',
          `      docker pull "$REGISTRY/app:latest@${digest}"`,
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "<memory>:3: $REGISTRY/app:latest is not pinned to a sha256 digest",
      "<memory>:4: $REGISTRY/app:v1.2 is not pinned to a sha256 digest",
      "<memory>:5: $REGISTRY/team/worker is not pinned to a sha256 digest",
    ]);
    expect(
      unpinnedContainerfileReferences(
        `#!/usr/bin/env buildctl\n# syntax=docker/dockerfile:1.9\nFROM node:24@${digest}\n`,
      ),
    ).toEqual(["<memory>:2: docker/dockerfile:1.9 is not pinned to a sha256 digest"]);
    expect(
      unpinnedContainerfileReferences(`// syntax=docker/dockerfile:1.10\nFROM node:24@${digest}\n`),
    ).toEqual(["<memory>:1: docker/dockerfile:1.10 is not pinned to a sha256 digest"]);
    expect(unpinnedContainerfileReferences('{\n  "syntax": "my/frontend:latest"\n}\n')).toEqual([
      "<memory>:2: my/frontend:latest is not pinned to a sha256 digest",
    ]);
    expect(
      unpinnedContainerfileReferences(`{\n  "syntax": "my/frontend:latest@${digest}"\n}\n`),
    ).toEqual([]);
    // Containerfile FROM / COPY --from / RUN --mount with dynamic repository
    // prefixes (e.g. `${TARGETARCH}/alpine:3.20`) still flag provably unpinned
    // literal tags, while allowing opaque dynamic stage references (`${STAGE}`).
    expect(
      unpinnedContainerfileReferences(
        [
          "ARG STAGE",
          "FROM ${TARGETARCH}/alpine:3.20 AS builder",
          "FROM ${STAGE}",
          "ARG TARGETARCH",
          "COPY --from=${TARGETARCH}/busybox:1.36 /bin/sh /sh",
          "RUN --mount=type=bind,from=${TARGETARCH}/tools:latest,source=/bin,target=/mnt true",
          `FROM \${TARGETARCH}/alpine:3.20@${digest}`,
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "<memory>:2: ${TARGETARCH}/alpine:3.20 is not pinned to a sha256 digest",
      "<memory>:5: ${TARGETARCH}/busybox:1.36 is not pinned to a sha256 digest",
      "<memory>:6: ${TARGETARCH}/tools:latest is not pinned to a sha256 digest",
    ]);
    // Non-input triggers (`push`, `schedule`) still evaluate `inputs.*` and
    // `github.event.inputs.*` to empty strings even when `workflow_dispatch`
    // declares only optional inputs with no defaults or choices; and dynamic
    // SBOM generator / buildx create / build-context image prefixes with literal
    // tags are flagged.
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "on:",
          "  push:",
          "  workflow_dispatch:",
          "    inputs:",
          "      suffix:",
          "        description: Optional digest suffix",
          "jobs:",
          "  build:",
          "    runs-on: ubuntu-latest",
          "    container: alpine:3.20${{ inputs.suffix }}",
          "    steps:",
          "      - run: |",
          '          docker buildx create --driver docker-container --driver-opt image="$REGISTRY/buildkit:v0.35.1"',
          '          docker buildx build --attest type=sbom,generator="$REGISTRY/syft:latest" --build-context tools=docker-image://"$REGISTRY/tools:1.0" .',
          '          docker buildx build --attest "${{ inputs.attest }}" .',
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "<memory>:10: alpine:3.20 is not pinned to a sha256 digest",
      "<memory>:13: $REGISTRY/buildkit:v0.35.1 is not pinned to a sha256 digest",
      "<memory>:14: $REGISTRY/tools:1.0 is not pinned to a sha256 digest",
      "<memory>:14: $REGISTRY/syft:latest is not pinned to a sha256 digest",
    ]);
    // Event guards (`if: github.event_name == 'workflow_dispatch'`) prevent
    // push/schedule empty-input contexts from flagging dispatch-only jobs and
    // steps whose dispatch choices are pinned, while still catching unpinned
    // images in dispatch-only or unguarded jobs.
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "on:",
          "  push:",
          "  workflow_dispatch:",
          "    inputs:",
          "      digest:",
          "        type: choice",
          "        options:",
          `          - ${digest}`,
          "jobs:",
          "  dispatch-only-pinned:",
          "    if: github.event_name == 'workflow_dispatch'",
          "    runs-on: ubuntu-latest",
          "    container: node:24@${{ inputs.digest }}",
          "  step-guarded-pinned:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - if: ${{ github.event_name == 'workflow_dispatch' }}",
          "        run: docker pull node:24@${{ inputs.digest }}",
          "  dispatch-only-unpinned:",
          "    if: github.event_name == 'workflow_dispatch'",
          "    runs-on: ubuntu-latest",
          "    container: alpine:3.20",
          "  unguarded-uses-dispatch-input:",
          "    runs-on: ubuntu-latest",
          "    container: node:24@${{ inputs.digest }}",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "<memory>:22: alpine:3.20 is not pinned to a sha256 digest",
      "<memory>:25: node:24@ is not pinned to a sha256 digest",
    ]);
    // Reusable workflows inherit the caller's `github.event_name` (and treat it
    // as unknown during standalone checks), resolve implicit type defaults (`""`,
    // `false`, `0`) for omitted optional `workflow_call` inputs, and Compose
    // commands that pull/build/start services fail closed.
    const r43Fixture = await mkdtemp(join(tmpdir(), "palamedes-pins-r43-"));
    try {
      await mkdir(join(r43Fixture, ".github", "workflows"), { recursive: true });
      await writeFile(
        join(r43Fixture, ".github", "workflows", "reusable.yml"),
        [
          "on:",
          "  workflow_call:",
          "    inputs:",
          "      suffix:",
          "        type: string",
          "      port:",
          "        type: number",
          "jobs:",
          "  on-push:",
          "    if: github.event_name == 'push'",
          "    runs-on: ubuntu-latest",
          "    container: alpine${{ inputs.suffix }}",
          "  on-schedule:",
          "    if: github.event_name == 'schedule'",
          "    runs-on: ubuntu-latest",
          "    container: busybox:${{ inputs.port }}",
          "",
        ].join("\n"),
      );
      await writeFile(
        join(r43Fixture, ".github", "workflows", "caller.yml"),
        [
          "on: push",
          "jobs:",
          "  call-reusable:",
          "    uses: ./.github/workflows/reusable.yml",
          "  run-compose:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - run: docker compose up -d",
          "",
        ].join("\n"),
      );
      const r43Result = checkWorkflowPins(r43Fixture);
      expect(r43Result.problems).toEqual([
        ".github/workflows/reusable.yml:12: alpine is not pinned to a sha256 digest",
        ".github/workflows/caller.yml:8: docker compose up target definitions cannot be verified statically for container image digests",
      ]);
      // Standalone reusable workflow scan treats caller event_name as unknown,
      // so guarded jobs with literal unpinned images are still checked.
      expect(
        unpinnedWorkflowContainerReferences(
          [
            "on: workflow_call",
            "jobs:",
            "  push-only:",
            "    if: github.event_name == 'push'",
            "    runs-on: ubuntu-latest",
            "    container: alpine:3.20",
            "",
          ].join("\n"),
        ),
      ).toEqual(["<memory>:6: alpine:3.20 is not pinned to a sha256 digest"]);
    } finally {
      await rm(r43Fixture, { recursive: true, force: true });
    }
    // Job/service `container.options` image mounts, literal `GITHUB_OUTPUT`
    // step outputs (while keeping runtime-derived image IDs dynamic), and
    // omitted optional `workflow_dispatch` string inputs are checked.
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "on:",
          "  workflow_dispatch:",
          "    inputs:",
          "      suffix:",
          "        description: Optional digest suffix",
          "jobs:",
          "  build:",
          "    runs-on: ubuntu-latest",
          "    container:",
          `      image: node:24@${digest}`,
          "      options: --mount type=image,source=alpine:3.20,target=/mnt",
          "    services:",
          "      db:",
          `        image: postgres:16@${digest}`,
          "        options: --mount=type=image,src=busybox:1.36,dst=/tools",
          "    steps:",
          "      - id: pick",
          '        run: echo "img=nginx:1.27" >> "$GITHUB_OUTPUT"',
          "      - id: local-build",
          "        run: |",
          "          IMAGE_ID=$(docker images -q local:test)",
          '          echo "img=$IMAGE_ID" >> "$GITHUB_OUTPUT"',
          "      - run: |",
          '          docker run --rm "${{ steps.pick.outputs.img }}" true',
          '          docker run --rm "${{ steps.local-build.outputs.img }}" true',
          "          docker pull alpine${{ inputs.suffix }}",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "<memory>:11: alpine:3.20 is not pinned to a sha256 digest",
      "<memory>:15: busybox:1.36 is not pinned to a sha256 digest",
      "<memory>:24: nginx:1.27 is not pinned to a sha256 digest",
      "<memory>:26: alpine is not pinned to a sha256 digest",
    ]);
    // Conditional `GITHUB_ENV` writes preserve the unset branch (empty string)
    // when expanded via `${{ env.* }}`, and local composite action
    // `outputs.*.value` mappings propagate literal and step-output image refs
    // to callers.
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "jobs:",
          "  build:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - if: github.ref == 'refs/heads/main'",
          `        run: echo "SUFFIX=@${digest}" >> "$GITHUB_ENV"`,
          "      - run: docker pull alpine:3.20${{ env.SUFFIX }}",
          "",
        ].join("\n"),
      ),
    ).toEqual(["<memory>:7: alpine:3.20 is not pinned to a sha256 digest"]);
    const r46Fixture = await mkdtemp(join(tmpdir(), "palamedes-pins-r46-"));
    try {
      await mkdir(join(r46Fixture, ".github", "actions", "pick-image"), { recursive: true });
      await mkdir(join(r46Fixture, ".github", "workflows"), { recursive: true });
      await writeFile(
        join(r46Fixture, ".github", "actions", "pick-image", "action.yml"),
        [
          "name: pick-image",
          "outputs:",
          "  literal_img:",
          "    description: Literal tag",
          "    value: redis:7",
          "  step_img:",
          "    description: Inner step output",
          "    value: ${{ steps.inner.outputs.ref }}",
          "runs:",
          "  using: composite",
          "  steps:",
          "    - id: inner",
          "      shell: bash",
          '      run: echo "ref=caddy:2" >> "$GITHUB_OUTPUT"',
          "",
        ].join("\n"),
      );
      await writeFile(
        join(r46Fixture, ".github", "workflows", "ci.yml"),
        [
          "on: push",
          "jobs:",
          "  run:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - id: pick",
          "        uses: ./.github/actions/pick-image",
          "      - run: |",
          '          docker pull "${{ steps.pick.outputs.literal_img }}"',
          '          docker pull "${{ steps.pick.outputs.step_img }}"',
          "",
        ].join("\n"),
      );
      expect(checkWorkflowPins(r46Fixture).problems).toEqual([
        ".github/workflows/ci.yml:9: redis:7 is not pinned to a sha256 digest",
        ".github/workflows/ci.yml:10: caddy:2 is not pinned to a sha256 digest",
      ]);
      // Running the pin-check CLI from a subdirectory resolves the repository
      // root instead of passing an empty scan, while an explicit empty target
      // directory exits non-zero.
      const subDirRun = spawnSync(
        process.execPath,
        [resolve(repositoryRoot, "scripts/check-workflow-pins.mjs")],
        { cwd: resolve(repositoryRoot, "packages/core"), encoding: "utf8" },
      );
      expect(subDirRun.status).toBe(0);
      expect(subDirRun.stdout).toMatch(/check-workflow-pins: [1-9]\d* workflow files/u);
      const emptyDir = await mkdtemp(join(tmpdir(), "palamedes-pins-empty-"));
      try {
        const emptyRun = spawnSync(
          process.execPath,
          [resolve(repositoryRoot, "scripts/check-workflow-pins.mjs"), emptyDir],
          { cwd: repositoryRoot, encoding: "utf8" },
        );
        expect(emptyRun.status).toBe(1);
        expect(emptyRun.stderr).toContain("no workflow or container files found");
      } finally {
        await rm(emptyDir, { recursive: true, force: true });
      }
    } finally {
      await rm(r46Fixture, { recursive: true, force: true });
    }
    // Literal fallback values in Actions expressions (`${{ inputs.image || 'node:24' }}`,
    // `${{ cond && 'a' || 'b' }}`), upstream job outputs (`needs.<id>.outputs.*`),
    // and always-true step guards (`if: github.event_name == 'push'` on a push-only
    // workflow) are evaluated accurately.
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "on: push",
          "jobs:",
          "  consume:",
          "    needs: setup",
          "    runs-on: ubuntu-latest",
          "    container: ${{ needs.setup.outputs.image }}",
          "    steps:",
          "      - if: github.event_name == 'push'",
          `        run: echo "SUFFIX=@${digest}" >> "$GITHUB_ENV"`,
          "      - run: |",
          "          docker pull alpine:3.20${{ env.SUFFIX }}",
          '          docker pull "${{ needs.setup.outputs.from_step }}"',
          '          docker run --rm "${{ needs.setup.outputs.runtime_id }}" true',
          "  setup:",
          "    runs-on: ubuntu-latest",
          "    outputs:",
          "      image: alpine:3.20",
          "      from_step: ${{ steps.pick.outputs.ref }}",
          "      runtime_id: ${{ steps.build.outputs.id }}",
          "    steps:",
          "      - id: pick",
          '        run: echo "ref=nginx:1.27" >> "$GITHUB_OUTPUT"',
          "      - id: build",
          "        run: |",
          "          ID=$(docker images -q local:test)",
          '          echo "id=$ID" >> "$GITHUB_OUTPUT"',
          "  fallback-checks:",
          "    runs-on: ubuntu-latest",
          "    container: ${{ inputs.image || 'node:24' }}",
          "    steps:",
          "      - run: |",
          `          docker pull "\${{ github.ref == 'refs/heads/main' && 'busybox:1.36' || 'node:24@${digest}' }}"`,
          `          docker pull "\${{ inputs.pinned || 'node:24@${digest}' }}"`,
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "<memory>:17: alpine:3.20 is not pinned to a sha256 digest",
      "<memory>:12: nginx:1.27 is not pinned to a sha256 digest",
      "<memory>:29: node:24 is not pinned to a sha256 digest",
      "<memory>:32: busybox:1.36 is not pinned to a sha256 digest",
    ]);
    // A required finite `choice` dispatch input short-circuits `||` before a
    // fallback branch, while a free-form string input (even with a non-empty
    // default) or an omitted optional input can still reach the fallback when
    // dispatched with an empty value.
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "on:",
          "  workflow_dispatch:",
          "    inputs:",
          "      pinned_choice:",
          "        type: choice",
          "        required: true",
          "        options:",
          `          - node:24@${digest}`,
          "      pinned_default:",
          `        default: node:24@${digest}`,
          "      optional_img:",
          "        description: Optional override",
          "jobs:",
          "  short-circuit:",
          "    runs-on: ubuntu-latest",
          "    container: ${{ inputs.pinned_choice || 'node:24' }}",
          "  freeform-reaches-fallback:",
          "    runs-on: ubuntu-latest",
          "    container: ${{ inputs.pinned_default || 'busybox:1.36' }}",
          "  reaches-fallback:",
          "    runs-on: ubuntu-latest",
          "    container: ${{ inputs.optional_img || 'alpine:3.20' }}",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "<memory>:22: alpine:3.20 is not pinned to a sha256 digest",
      "<memory>:19: busybox:1.36 is not pinned to a sha256 digest",
    ]);
    // Non-input triggers (`push`, `pull_request`) are analyzed per-event so
    // push-only `GITHUB_ENV` writes are not polluted by the pull_request pass;
    // boolean `false` and numeric `0` `inputs.*` remain falsy in `||`
    // expressions while `github.event.inputs.*` stays string-valued; and
    // reusable workflow `on.workflow_call.outputs` propagate to downstream jobs.
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "on: [push, pull_request]",
          "env:",
          "  IMAGE: unset-placeholder",
          "jobs:",
          "  push-only-scoped:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - if: github.event_name == 'push'",
          `        run: echo "IMAGE=alpine:3.20@${digest}" >> "$GITHUB_ENV"`,
          "      - if: github.event_name == 'push'",
          '        run: docker pull "$IMAGE"',
          "  cross-event-leak:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - if: github.event_name == 'push'",
          `        run: echo "IMAGE=alpine:3.20@${digest}" >> "$GITHUB_ENV"`,
          '      - run: docker pull "$IMAGE"',
          "",
        ].join("\n"),
      ),
    ).toEqual(["<memory>:3: unset-placeholder is not pinned to a sha256 digest"]);
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "on:",
          "  workflow_dispatch:",
          "    inputs:",
          "      use_custom:",
          "        type: boolean",
          "        default: false",
          "      use_canary:",
          "        type: boolean",
          "        default: false",
          "      count:",
          "        type: number",
          "        default: 0",
          "jobs:",
          "  typed-falsy:",
          "    runs-on: ubuntu-latest",
          `    container: \${{ inputs.use_custom && 'alpine:3.20@${digest}' || 'node:24@${digest}' }}`,
          "    steps:",
          `      - run: docker pull "\${{ inputs.count || 'alpine:3.20@${digest}' }}"`,
          "      - run: docker pull \"${{ inputs.count || 'busybox:1.36' }}\"",
          `      - run: docker pull "\${{ inputs.use_canary && 'node:24' || 'node:24@${digest}' }}"`,
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "<memory>:19: busybox:1.36 is not pinned to a sha256 digest",
      "<memory>:20: node:24 is not pinned to a sha256 digest",
    ]);
    const r48Fixture = await mkdtemp(join(tmpdir(), "palamedes-pins-r48-"));
    try {
      await mkdir(join(r48Fixture, ".github", "workflows"), { recursive: true });
      await writeFile(
        join(r48Fixture, ".github", "workflows", "reusable-outputs.yml"),
        [
          "on:",
          "  workflow_call:",
          "    outputs:",
          "      pinned_img:",
          "        value: ${{ jobs.pick.outputs.pinned_img }}",
          "      mutable_img:",
          "        value: ${{ jobs.pick.outputs.mutable_img }}",
          "jobs:",
          "  pick:",
          "    runs-on: ubuntu-latest",
          "    outputs:",
          `      pinned_img: node:24@${digest}`,
          "      mutable_img: nginx:1.27",
          "    steps:",
          "      - run: echo ok",
          "",
        ].join("\n"),
      );
      await writeFile(
        join(r48Fixture, ".github", "workflows", "caller-outputs.yml"),
        [
          "on: push",
          "jobs:",
          "  source:",
          "    uses: ./.github/workflows/reusable-outputs.yml",
          "  consume-pinned:",
          "    needs: source",
          "    runs-on: ubuntu-latest",
          "    container: ${{ needs.source.outputs.pinned_img || 'unset' }}",
          "  consume-mutable:",
          "    needs: source",
          "    runs-on: ubuntu-latest",
          "    container: ${{ needs.source.outputs.mutable_img }}",
          "",
        ].join("\n"),
      );
      expect(checkWorkflowPins(r48Fixture).problems).toEqual([
        ".github/workflows/caller-outputs.yml:4: nginx:1.27 is not pinned to a sha256 digest",
      ]);
    } finally {
      await rm(r48Fixture, { recursive: true, force: true });
    }
    // An empty final `|| ''` fallback operand and `format(...)` expressions are
    // evaluated so mutable image references cannot slip past the pin gate.
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "jobs:",
          "  expr-pins:",
          "    runs-on: ubuntu-latest",
          "    container: alpine:3.20${{ inputs.digest || '' }}",
          "    steps:",
          "      - run: |",
          "          docker pull \"${{ format('{0}:{1}', 'node', '24') }}\"",
          `          docker pull "\${{ format('{0}@{1}', 'node:24', '${digest}') }}"`,
          "          docker pull \"${{ format('ghcr.io/{0}/app:latest', github.repository_owner) }}\"",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "<memory>:4: alpine:3.20 is not pinned to a sha256 digest",
      "<memory>:7: node:24 is not pinned to a sha256 digest",
      "<memory>:9: ghcr.io/${{ dynamic }}/app:latest is not pinned to a sha256 digest",
    ]);
    // Unary `!` binds tighter than `&&` in Actions expressions, dispatch choices
    // exposed via upstream job outputs are traced, static `fromJSON(...)` image
    // matrices are decoded and checked, and truncated `format()` expansions fail
    // closed.
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "on:",
          "  workflow_dispatch:",
          "    inputs:",
          "      alternate:",
          "        type: boolean",
          "        default: false",
          "      chosen_img:",
          "        type: choice",
          "        required: true",
          "        options:",
          `          - node:24@${digest}`,
          "jobs:",
          "  choose:",
          "    runs-on: ubuntu-latest",
          "    outputs:",
          "      img: ${{ inputs.chosen_img }}",
          "    steps:",
          "      - run: echo ok",
          "  negation-and-needs:",
          "    needs: choose",
          "    runs-on: ubuntu-latest",
          `    container: \${{ !inputs.alternate && 'alpine:3.20@${digest}' || 'node:24@${digest}' }}`,
          "    steps:",
          "      - run: docker pull \"${{ needs.choose.outputs.img || 'unset' }}\"",
          "  json-matrix:",
          "    runs-on: ubuntu-latest",
          "    strategy:",
          `      matrix: \${{ fromJSON('{"include":[{"image":"node:24@${digest}"},{"image":"alpine:3.20"}]}') }}`,
          "    container: ${{ matrix.image }}",
          "    steps:",
          "      - run: echo ok",
          "",
        ].join("\n"),
      ),
    ).toEqual(["<memory>:28: alpine:3.20 is not pinned to a sha256 digest"]);
    const nineChoices = Array.from({ length: 9 }, (_, i) => `a${i}`);
    const makeConditionalEnv = (varName, values) => [
      ...values.map((val, idx) =>
        idx === 0
          ? `if [ "$X" = "${idx}" ]; then echo "${varName}=${val}" >> "$GITHUB_ENV"`
          : `elif [ "$X" = "${idx}" ]; then echo "${varName}=${val}" >> "$GITHUB_ENV"`,
      ),
      "fi",
    ];
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "jobs:",
          "  format-overflow:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - run: |",
          ...makeConditionalEnv("A", nineChoices).map((line) => `          ${line}`),
          ...makeConditionalEnv("B", nineChoices).map((line) => `          ${line}`),
          `      - run: docker pull "\${{ format('{0}/{1}@${digest}', env.A, env.B) }}"`,
          "",
        ].join("\n"),
      ),
    ).toContain(
      "<memory>:26: run script env expression exceeds expansion limit and cannot be verified exhaustively",
    );
    // Matrix properties inside `${{ matrix.image || '...' }}` resolve per row
    // before fallback selection; alternative JSON exclusion lists and partially
    // empty JSON matrix outputs keep valid rows separate; and shell continued
    // `&&`/`||` lines, function declarations, pipelines, and background `&`
    // commands preserve accurate parent-shell variable state.
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "jobs:",
          "  matrix-fallback:",
          "    runs-on: ubuntu-latest",
          "    strategy:",
          "      matrix:",
          "        image:",
          "          - node:24",
          '          - ""',
          `    container: \${{ matrix.image || 'node:24@${digest}' }}`,
          "    steps:",
          "      - run: echo ok",
          "  alt-excludes-producer:",
          "    runs-on: ubuntu-latest",
          "    outputs:",
          "      ex: ${{ steps.pick.outputs.ex }}",
          "      mat: ${{ steps.pick.outputs.mat }}",
          "    steps:",
          "      - id: pick",
          "        run: |",
          '          if [ "$MODE" = "a" ]; then',
          '            echo \'ex=[{"image":"alpine:3.20"}]\' >> "$GITHUB_OUTPUT"',
          '            echo \'mat={"include":[{"image":"busybox:1.36"}]}\' >> "$GITHUB_OUTPUT"',
          "          else",
          '            echo \'ex=[{"image":"nginx:1.27"}]\' >> "$GITHUB_OUTPUT"',
          '            echo "mat=" >> "$GITHUB_OUTPUT"',
          "          fi",
          "  alt-excludes-consumer:",
          "    needs: alt-excludes-producer",
          "    runs-on: ubuntu-latest",
          "    strategy:",
          "      matrix:",
          "        image:",
          "          - alpine:3.20",
          "          - nginx:1.27",
          "        exclude: ${{ fromJSON(needs.alt-excludes-producer.outputs.ex) }}",
          "    container: ${{ matrix.image }}",
          "    steps:",
          "      - run: echo ok",
          "  partial-json-consumer:",
          "    needs: alt-excludes-producer",
          "    runs-on: ubuntu-latest",
          "    strategy:",
          "      matrix: ${{ fromJSON(needs.alt-excludes-producer.outputs.mat) }}",
          "    container: ${{ matrix.image }}",
          "    steps:",
          "      - run: echo ok",
          "  shell-scoping:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - run: |",
          `          IMAGE=node:24@${digest}`,
          "          helper() {",
          "            IMAGE=unused:latest",
          "            local LOCAL_IMG=ignored:latest",
          "          }",
          "          IMAGE=pipe-unused:latest | cat",
          "          IMAGE=bg-unused:latest &",
          '          docker pull "$IMAGE"',
          "          CONT=alpine:3.20",
          '          test -n "$OVERRIDE" &&',
          `            CONT=alpine:3.20@${digest}`,
          '          docker pull "$CONT"',
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "<memory>:7: node:24 is not pinned to a sha256 digest",
      "<memory>:34: nginx:1.27 is not pinned to a sha256 digest",
      "<memory>:33: alpine:3.20 is not pinned to a sha256 digest",
      "<memory>:43: busybox:1.36 is not pinned to a sha256 digest",
      "<memory>:59: alpine:3.20 is not pinned to a sha256 digest",
    ]);
    // Typed matrix scalars (`false`, `0`), free-form workflow_dispatch inputs
    // with non-default caller values, brace-bodied Bash function calls mutating
    // caller variables (while `local` stays scoped), hyphenated `$GITHUB_OUTPUT`
    // keys (single-line and heredoc), and job-output expansion truncation.
    const truncatedBranches = (varName) => [
      ...Array.from(
        { length: 9 },
        (_, i) =>
          `          ${i === 0 ? "if" : "elif"} [ "$X" = "${i}" ]; then echo "${varName}=a${i}" >> "$GITHUB_OUTPUT"`,
      ),
      "          fi",
    ];
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "on:",
          "  workflow_dispatch:",
          "    inputs:",
          "      count:",
          "        type: number",
          "        default: 0",
          "jobs:",
          "  typed-matrix:",
          "    runs-on: ubuntu-latest",
          "    strategy:",
          "      matrix:",
          "        flag: [false]",
          "        zero: [0]",
          `    container: \${{ (matrix.flag || matrix.zero) && 'alpine:3.20' || 'node:24@${digest}' }}`,
          "    steps:",
          "      - run: echo ok",
          "  dispatch-freeform:",
          "    runs-on: ubuntu-latest",
          `    container: \${{ inputs.count && 'busybox:1.36' || 'node:24@${digest}' }}`,
          "    steps:",
          "      - run: echo ok",
          "  fn-and-hyphen-outputs:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - id: pick",
          "        run: |",
          "          IMAGE=placeholder:latest",
          "          set_pinned() {",
          `            IMAGE=node:24@${digest}`,
          "            local LOCAL_ONLY=ignored:latest",
          "          }",
          "          set_pinned",
          '          docker pull "$IMAGE"',
          `          echo "image-ref=node:24@${digest}" >> "$GITHUB_OUTPUT"`,
          "          cat <<'EOF' >> \"$GITHUB_OUTPUT\"",
          "          multi-ref<<END",
          `          alpine:3.20@${digest}`,
          "          END",
          "          EOF",
          "      - run: |",
          "          docker pull \"${{ steps.pick.outputs.image-ref || 'unpinned-fallback:1' }}\"",
          "          docker pull \"${{ steps.pick.outputs.multi-ref || 'unpinned-fallback:2' }}\"",
          "  trunc-producer:",
          "    runs-on: ubuntu-latest",
          "    outputs:",
          `      ref: \${{ format('{0}/{1}@${digest}', steps.gen.outputs.x, steps.gen.outputs.y) }}`,
          "    steps:",
          "      - id: gen",
          "        run: |",
          ...truncatedBranches("x"),
          ...truncatedBranches("y"),
          "  trunc-consumer:",
          "    needs: trunc-producer",
          "    runs-on: ubuntu-latest",
          "    container: ${{ needs.trunc-producer.outputs.ref }}",
          "    steps:",
          "      - run: echo ok",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "<memory>:73: ${{ needs.trunc-producer.outputs.ref }} exceeds expansion limit and cannot be verified exhaustively",
      "<memory>:19: busybox:1.36 is not pinned to a sha256 digest",
    ]);
    // Bounded matrix fingerprinting handles shared YAML aliases without OOM,
    // typed matrix exclude/include keeps boolean `false` distinct from `'false'`,
    // truncated `fromJSON(...)` matrices fail closed, shell functions bind
    // positional args (`$1`) and fail closed at depth limit, and false guards
    // (including substituted boolean dispatch inputs) skip dead branches.
    const deepAliasMatrixLines = [
      "x-m0: &m0",
      "  leaf: ok",
      ...Array.from(
        { length: 24 },
        (_, idx) => `x-m${idx + 1}: &m${idx + 1}\n  a: *m${idx}\n  b: *m${idx}`,
      ),
      "jobs:",
      "  aliased-matrix:",
      "    runs-on: ubuntu-latest",
      "    strategy:",
      "      matrix:",
      "        cfg: [*m24]",
      `    container: node:24@${digest}`,
      "    steps:",
      "      - run: echo ok",
      "  typed-exclude:",
      "    runs-on: ubuntu-latest",
      "    strategy:",
      "      matrix:",
      "        flag:",
      "          - false",
      '          - "false"',
      "        exclude:",
      "          - flag: false",
      `    container: \${{ matrix.flag && 'alpine:3.20' || 'node:24@${digest}' }}`,
      "    steps:",
      "      - run: echo ok",
      "  trunc-matrix-src:",
      "    runs-on: ubuntu-latest",
      "    outputs:",
      `      mat: \${{ format('{"image":["{0}/{1}@${digest}"]}', steps.gen.outputs.x, steps.gen.outputs.y) }}`,
      "    steps:",
      "      - id: gen",
      "        run: |",
      ...truncatedBranches("x"),
      ...truncatedBranches("y"),
      "  trunc-matrix-use:",
      "    needs: trunc-matrix-src",
      "    runs-on: ubuntu-latest",
      "    strategy:",
      "      matrix: ${{ fromJSON(needs.trunc-matrix-src.outputs.mat) }}",
      "    container: ${{ matrix.image }}",
      "    steps:",
      "      - run: echo ok",
      "  fn-args-and-depth:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: |",
      '          pull_it() { docker pull "$1"; }',
      '          pull_it "busybox:1.36"',
      "          f0() { f1; }",
      "          f1() { f2; }",
      "          f2() { f3; }",
      "          f3() { f4; }",
      "          f4() { f5; }",
      "          f5() { f6; }",
      "          f6() { f7; }",
      "          f7() { f8; }",
      "          f8() { docker pull redis:7; }",
      "          f0",
      "  false-guard:",
      "    if: false",
      "    runs-on: ubuntu-latest",
      "    container: ignored-dead-job:latest",
      "    steps:",
      "      - run: docker pull ignored-dead-step:latest",
      "",
    ];
    const r54Diagnostics = unpinnedWorkflowContainerReferences(deepAliasMatrixLines.join("\n"));
    expect(r54Diagnostics).toEqual([
      "<memory>:90: alpine:3.20 is not pinned to a sha256 digest",
      "<memory>:127: ${{ fromJSON(needs.trunc-matrix-src.outputs.mat) }} exceeds expansion limit and cannot be verified exhaustively",
      "<memory>:136: busybox:1.36 is not pinned to a sha256 digest",
      "<memory>:144: shell function call f8 exceeds maximum nesting depth (8) and cannot be verified",
      "<memory>:145: redis:7 is not pinned to a sha256 digest",
    ]);
    // Reusable workflow receives caller's `github.event.inputs.*` independently
    // from its own `workflow_call` `inputs.*`, and false substituted boolean
    // guards skip disabled branches cleanly.
    const r54Fixture = await mkdtemp(join(tmpdir(), "palamedes-pins-r54-"));
    try {
      await mkdir(join(r54Fixture, ".github", "workflows"), { recursive: true });
      await writeFile(join(r54Fixture, "Containerfile"), `FROM node:24@${digest}\n`);
      await writeFile(
        join(r54Fixture, ".github", "workflows", "callee.yml"),
        [
          "on:",
          "  workflow_call:",
          "jobs:",
          "  run:",
          "    runs-on: ubuntu-latest",
          "    container: ${{ github.event.inputs.choice_img || 'unreachable:latest' }}",
          "    steps:",
          "      - run: echo ok",
          "",
        ].join("\n"),
      );
      const callerPinned = [
        "on:",
        "  workflow_dispatch:",
        "    inputs:",
        "      choice_img:",
        "        type: choice",
        "        required: true",
        "        options:",
        `          - node:24@${digest}`,
        "      use_custom:",
        "        type: boolean",
        "        default: false",
        "jobs:",
        "  delegate:",
        "    uses: ./.github/workflows/callee.yml",
        "  guarded-build:",
        "    if: inputs.use_custom",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - if: false",
        "        run: docker build -f missing.Containerfile .",
        "      - run: docker build -f Containerfile .",
        "",
      ].join("\n");
      expect(
        unpinnedWorkflowContainerReferences(callerPinned, ".github/workflows/caller.yml", {
          root: r54Fixture,
        }),
      ).toEqual([]);
      const callerUnpinned = callerPinned.replace(
        `          - node:24@${digest}`,
        `          - node:24@${digest}\n          - alpine:3.20`,
      );
      expect(
        unpinnedWorkflowContainerReferences(callerUnpinned, ".github/workflows/caller.yml", {
          root: r54Fixture,
        }),
      ).toEqual([".github/workflows/callee.yml:6: alpine:3.20 is not pinned to a sha256 digest"]);
    } finally {
      await rm(r54Fixture, { recursive: true, force: true });
    }
    // Step `env:` resolves against enclosing env before installing overrides;
    // wrapped `if: ${{ inputs.feature }}` preserves string input types (so
    // choice `"false"` is truthy); matrix `if:` equality applies Actions loose
    // coercion (`24 == '24.0'`); separate aliased matrix trees memoize pair
    // comparisons; `docker service create` / `update --image` are checked; and
    // local Podman archive transports (`oci-archive:`) are not treated as
    // registry tags.
    const r55Lines = [
      "on:",
      "  workflow_dispatch:",
      "    inputs:",
      "      feature:",
      "        type: choice",
      "        required: true",
      "        options:",
      '          - "false"',
      "env:",
      "  BASE: node:24",
      "x-a0: &a0",
      "  leaf: ok",
      ...Array.from(
        { length: 22 },
        (_, idx) => `x-a${idx + 1}: &a${idx + 1}\n  l: *a${idx}\n  r: *a${idx}`,
      ),
      "x-b0: &b0",
      "  leaf: ok",
      ...Array.from(
        { length: 22 },
        (_, idx) => `x-b${idx + 1}: &b${idx + 1}\n  l: *b${idx}\n  r: *b${idx}`,
      ),
      "jobs:",
      "  env-override:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - env:",
      "          IMAGE: ${{ env.BASE }}",
      `          BASE: node:24@${digest}`,
      '        run: docker pull "$IMAGE"',
      "  wrapped-if:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - if: ${{ inputs.feature }}",
      "        run: docker pull alpine:3.20",
      "  loose-matrix-eq:",
      "    runs-on: ubuntu-latest",
      "    strategy:",
      "      matrix:",
      "        node: [24]",
      "        tree: [*a22]",
      "        exclude:",
      "          - tree: *b22",
      "            node: 99",
      "    steps:",
      "      - if: matrix.node == '24.0'",
      "        run: docker pull busybox:1.36",
      "  swarm-and-podman:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: |",
      "          docker service create --name web nginx:1.27",
      "          docker service update --image redis:7 web",
      `          docker service update --image redis:7@${digest} web`,
      "          podman pull oci-archive:/tmp/image.tar",
      "          podman pull docker-archive:/tmp/image.tar",
      "",
    ];
    expect(unpinnedWorkflowContainerReferences(r55Lines.join("\n"))).toEqual([
      "<memory>:152: node:24 is not pinned to a sha256 digest",
      "<memory>:159: alpine:3.20 is not pinned to a sha256 digest",
      "<memory>:171: busybox:1.36 is not pinned to a sha256 digest",
      "<memory>:176: nginx:1.27 is not pinned to a sha256 digest",
      "<memory>:177: redis:7 is not pinned to a sha256 digest",
    ]);
    // Uncalled shell helpers do not pollute later steps' `GITHUB_ENV` /
    // `GITHUB_OUTPUT`, object-valued matrix entries satisfy `!= null`, OR
    // runner guards prune non-matching rows, and unary `!` binds tighter than
    // `==`/`!=` in Actions guards.
    const r56Fixture = await mkdtemp(join(tmpdir(), "palamedes-pins-r56-"));
    try {
      await mkdir(join(r56Fixture, ".github", "workflows"), { recursive: true });
      await mkdir(join(r56Fixture, "unix"), { recursive: true });
      await writeFile(join(r56Fixture, "unix", "Dockerfile"), `FROM node:24@${digest}\n`);
      const r56Workflow = [
        "on: push",
        "jobs:",
        "  uncalled-helper-isolation:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - id: init",
        "        run: |",
        '          echo "IMG=alpine:3.20" >> "$GITHUB_ENV"',
        '          echo "ref=busybox:1.36" >> "$GITHUB_OUTPUT"',
        "          unused_helper() {",
        `            echo "IMG=node:24@${digest}" >> "$GITHUB_ENV"`,
        `            echo "ref=node:24@${digest}" >> "$GITHUB_OUTPUT"`,
        "          }",
        "      - run: |",
        '          docker pull "$IMG"',
        '          docker pull "${{ steps.init.outputs.ref }}"',
        "  object-matrix-and-or-guard:",
        "    runs-on: ${{ matrix.os }}",
        "    strategy:",
        "      matrix:",
        "        include:",
        "          - os: ubuntu-latest",
        "            dir: unix",
        "            platform:",
        "              arch: amd64",
        "          - os: windows-latest",
        "            dir: missing-windows-dir",
        "    steps:",
        "      - if: matrix.platform != null",
        "        run: docker pull nginx:1.27",
        "      - if: runner.os == 'Linux' || runner.os == 'macOS'",
        "        working-directory: ${{ matrix.dir }}",
        "        run: docker build .",
        "  unary-negation-precedence:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - if: \"!github.event_name == 'schedule'\"",
        "        run: docker pull redis:7",
        "      - if: \"!(github.event_name == 'schedule')\"",
        "        run: docker pull postgres:17",
        "",
      ].join("\n");
      expect(
        unpinnedWorkflowContainerReferences(r56Workflow, ".github/workflows/r56.yml", {
          root: r56Fixture,
        }),
      ).toEqual([
        ".github/workflows/r56.yml:8: alpine:3.20 is not pinned to a sha256 digest",
        ".github/workflows/r56.yml:16: busybox:1.36 is not pinned to a sha256 digest",
        ".github/workflows/r56.yml:30: nginx:1.27 is not pinned to a sha256 digest",
        ".github/workflows/r56.yml:40: postgres:17 is not pinned to a sha256 digest",
      ]);
    } finally {
      await rm(r56Fixture, { recursive: true, force: true });
    }
    // Cleanup steps (`always()` / `failure()`) preserve pre-write env/output
    // state from earlier steps that could be skipped on failure, static matrix
    // array indexing (`matrix.images[0]`) is resolved, and Buildx
    // `--no-cache-filter <stage>` consumes its stage argument before the build
    // context path.
    const r57Fixture = await mkdtemp(join(tmpdir(), "palamedes-pins-r57-"));
    try {
      await mkdir(join(r57Fixture, ".github", "workflows"), { recursive: true });
      await writeFile(join(r57Fixture, "Dockerfile"), "FROM scratch AS build\n");
      const r57Workflow = [
        "on: push",
        "env:",
        "  IMG: alpine:3.20",
        "jobs:",
        "  failure-handler-state:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: ./may-fail.sh",
        "      - id: pick",
        "        run: |",
        `          echo "IMG=node:24@${digest}" >> "$GITHUB_ENV"`,
        `          echo "ref=node:24@${digest}" >> "$GITHUB_OUTPUT"`,
        "      - run: |",
        '          docker pull "$IMG"',
        "          docker pull \"${{ steps.pick.outputs.ref || 'ignored-on-success:1' }}\"",
        "      - if: always()",
        "        run: |",
        '          docker pull "$IMG"',
        "          docker pull \"${{ steps.pick.outputs.ref || 'busybox:1.36' }}\"",
        "  matrix-index-and-buildx:",
        "    runs-on: ubuntu-latest",
        "    strategy:",
        "      matrix:",
        "        include:",
        "          - images:",
        "              - nginx:1.27",
        `              - node:24@${digest}`,
        "    container: ${{ matrix.images[0] }}",
        "    steps:",
        "      - run: docker buildx build --no-cache-filter build .",
        "",
      ].join("\n");
      expect(
        unpinnedWorkflowContainerReferences(r57Workflow, ".github/workflows/r57.yml", {
          root: r57Fixture,
        }),
      ).toEqual([
        ".github/workflows/r57.yml:3: alpine:3.20 is not pinned to a sha256 digest",
        ".github/workflows/r57.yml:19: busybox:1.36 is not pinned to a sha256 digest",
        ".github/workflows/r57.yml:26: nginx:1.27 is not pinned to a sha256 digest",
      ]);
    } finally {
      await rm(r57Fixture, { recursive: true, force: true });
    }
    // Bash scalar `+=` appends concatenate tracked values, `docker run` stops
    // expanding application arguments after the image operand, `docker build
    // --help` skips Dockerfile discovery, and folded `run: >` scripts report
    // the exact line of the inspected image operand.
    const r58Fixture = await mkdtemp(join(tmpdir(), "palamedes-pins-r58-"));
    try {
      await mkdir(join(r58Fixture, ".github", "workflows"), { recursive: true });
      const flagSetup = Array.from(
        { length: 7 },
        (_, i) => `          if [ "$C${i}" = "1" ]; then F${i}=-a; else F${i}=-b; fi`,
      );
      const r58Workflow = [
        "on: push",
        "jobs:",
        "  r58:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: |",
        "          image=node:24",
        `          image+=@${digest}`,
        '          docker pull "$image"',
        ...flagSetup,
        `          docker run --rm node:24@${digest} app "$F0" "$F1" "$F2" "$F3" "$F4" "$F5" "$F6"`,
        "          docker build --help",
        "          docker buildx build -h",
        "      - run: >",
        "          echo node:24 &&",
        "          docker pull node:24",
        "",
      ].join("\n");
      expect(
        unpinnedWorkflowContainerReferences(r58Workflow, ".github/workflows/r58.yml", {
          root: r58Fixture,
        }),
      ).toEqual([".github/workflows/r58.yml:22: node:24 is not pinned to a sha256 digest"]);
    } finally {
      await rm(r58Fixture, { recursive: true, force: true });
    }
    // Unrelated job guards do not trigger workflow_dispatch combination limits;
    // dynamic tag overrides with a literal `@sha256:` digest are accepted; and
    // required digest `ARG`s without a default (`FROM node@sha256:${DIGEST}`)
    // are validated at build invocations without false failures in the
    // standalone Containerfile pass.
    const r59Fixture = await mkdtemp(join(tmpdir(), "palamedes-pins-r59-"));
    try {
      await mkdir(join(r59Fixture, ".github", "workflows"), { recursive: true });
      await writeFile(
        join(r59Fixture, "Dockerfile"),
        [
          "ARG BASE_TAG=24",
          "ARG DIGEST",
          `FROM node:\${BASE_TAG}@${digest} AS one`,
          "FROM node@sha256:${DIGEST} AS two",
          "",
        ].join("\n"),
      );
      const sevenChoices = ["a", "b", "c"]
        .map((k) => `      ${k}:\n        type: choice\n        options: [a, b, c, d, e, f, g]`)
        .join("\n");
      await writeFile(
        join(r59Fixture, ".github", "workflows", "r59.yml"),
        [
          "on:",
          "  workflow_dispatch:",
          "    inputs:",
          sevenChoices,
          "jobs:",
          "  unrelated:",
          "    runs-on: ubuntu-latest",
          "    if: inputs.a && inputs.b && inputs.c",
          "    steps:",
          "      - run: echo hello",
          "  build-pinned:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          `      - run: docker build --build-arg BASE_TAG="\${{ github.ref_name }}" --build-arg DIGEST=${"a".repeat(64)} .`,
          "",
        ].join("\n"),
      );
      expect(checkWorkflowPins(r59Fixture).problems).toEqual([]);
      await writeFile(
        join(r59Fixture, ".github", "workflows", "r59-bad.yml"),
        [
          "on: push",
          "jobs:",
          "  build-bad:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - run: docker build --build-arg DIGEST=not-hex .",
          "",
        ].join("\n"),
      );
      expect(checkWorkflowPins(r59Fixture).problems).toEqual([
        "Dockerfile:4: node@sha256:not-hex is not pinned to a sha256 digest",
      ]);
    } finally {
      await rm(r59Fixture, { recursive: true, force: true });
    }
    // Dockerfile lines ending in an escaped backslash (`\\`) are not treated
    // as continuations, quoted `FROM "${BASE}"` honors Dockerfile quoting, and
    // numeric heredoc delimiters (`COPY <<123`) keep payload lines out of
    // instruction validation.
    expect(
      unpinnedContainerfileReferences(
        [
          `ARG BASE=node:24@${digest}`,
          'FROM "${BASE}" AS build',
          "RUN echo literal\\\\",
          "FROM alpine:3.20 AS second",
          "COPY <<123 /sample.txt",
          "FROM example:test",
          "123",
          "",
        ].join("\n"),
      ),
    ).toEqual(["<memory>:4: alpine:3.20 is not pinned to a sha256 digest"]);
    // Bash arrays resolve in `for ... in "${images[@]}"` loops and indexed
    // `${images[0]}` reads, `printf -v` updates tracked shell variables, and
    // shell redirections like `<&0` / `3<> /tmp/fd` before the image operand
    // are skipped consistently.
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "on: push",
          "jobs:",
          "  r61:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - run: |",
          `          loop_images=(node:24@${digest} alpine:3.20)`,
          '          for img in "${loop_images[@]}"; do',
          '            docker pull "$img"',
          "          done",
          `          indexed_images=(node:24@${digest} debian:12)`,
          '          docker pull "${indexed_images[0]}"',
          '          docker pull "${indexed_images[1]}"',
          "          image=busybox:1.36",
          `          digest=${digest}`,
          '          printf -v image "%s@%s" "$image" "$digest"',
          '          docker pull "$image"',
          '          printf -v unpinned_img "%s:%s" ubuntu 24.04',
          '          docker pull "$unpinned_img"',
          `          docker run --rm <&0 3<> /tmp/fd node:24@${digest} echo ok`,
          "          docker run --rm <&0 nginx:1.27 echo bad",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "<memory>:7: alpine:3.20 is not pinned to a sha256 digest",
      "<memory>:11: debian:12 is not pinned to a sha256 digest",
      "<memory>:18: ubuntu:24.04 is not pinned to a sha256 digest",
      "<memory>:21: nginx:1.27 is not pinned to a sha256 digest",
    ]);
    // Bash helper functions forward `"$@"` to Docker commands, indexed array
    // writes (`images[0]=...`) update tracked elements in both directions,
    // unquoted `for img in $IMAGES` splits whitespace-separated operands, and
    // redirections placed between Docker flags and values (`--name >log smoke`)
    // are stripped before option parsing.
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "on: push",
          "jobs:",
          "  r62:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - run: |",
          "          run_image() {",
          '            docker run "$@"',
          "          }",
          "          outer_run() {",
          '            run_image "$@"',
          "          }",
          `          outer_run --rm node:24@${digest} echo ok`,
          "          outer_run --rm alpine:3.20 echo bad",
          `          arr=(node:24@${digest} debian:12)`,
          "          arr[0]=busybox:1.36",
          `          arr[1]=node:24@${digest}`,
          '          docker pull "${arr[0]}"',
          '          docker pull "${arr[1]}"',
          `          dyn_arr=(node:24@${digest})`,
          '          dyn_arr["$UNKNOWN_IDX"]=fedora:41',
          '          docker pull "${dyn_arr[0]}"',
          `          IMAGES="ubuntu:24.04 node:24@${digest}"`,
          "          for img in $IMAGES; do",
          '            docker pull "$img"',
          "          done",
          `          docker run --name >build.log smoke node:24@${digest} echo ok`,
          `          docker run --name ">" node:24@${digest} echo ok`,
          "          docker run --name >|build.log smoke nginx:1.27 echo bad",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "<memory>:14: alpine:3.20 is not pinned to a sha256 digest",
      "<memory>:16: busybox:1.36 is not pinned to a sha256 digest",
      "<memory>:21: fedora:41 is not pinned to a sha256 digest",
      "<memory>:24: ubuntu:24.04 is not pinned to a sha256 digest",
      "<memory>:29: nginx:1.27 is not pinned to a sha256 digest",
    ]);
    // Bash `shift` updates `$1`/`$@`, separated `2 >log` is not treated as an
    // fd redirection, exhaustive `case ... *)` drops stale entry values,
    // statically nonempty `for` loops drop stale pre-loop values, and deep
    // non-pin helper chains do not trigger false depth failures.
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "on: push",
          "jobs:",
          "  r63:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - run: |",
          "          pull_labeled() {",
          '            echo "$1"',
          "            shift",
          '            docker pull "$@"',
          "          }",
          `          pull_labeled ok-label node:24@${digest}`,
          "          pull_labeled bad-label alpine:3.20",
          `          docker run --cpus 2 >log node:24@${digest} echo hi`,
          "          case_img=debian:12",
          '          case "$TARGET" in',
          `            a) case_img=node:24@${digest} ;;`,
          `            *) case_img=node:24@${digest} ;;`,
          "          esac",
          '          docker pull "$case_img"',
          "          loop_img=ubuntu:24.04",
          "          for x in one two; do",
          `            loop_img=node:24@${digest}`,
          "          done",
          '          docker pull "$loop_img"',
          "          h1() { h2; }",
          "          h2() { h3; }",
          "          h3() { h4; }",
          "          h4() { h5; }",
          "          h5() { h6; }",
          "          h6() { h7; }",
          "          h7() { h8; }",
          "          h8() { h9; }",
          "          h9() { echo ok; }",
          "          h1",
          "",
        ].join("\n"),
      ),
    ).toEqual(["<memory>:13: alpine:3.20 is not pinned to a sha256 digest"]);
    // Grouped redirections (`{ ...; } >> "$GITHUB_ENV"` and
    // `( ... ) >> "$GITHUB_OUTPUT"`) propagate to inner echo/printf commands,
    // `BUILDKIT_SYNTAX=builtin` / `# syntax=builtin` are accepted as built-in
    // frontends, and `docker buildx create --help` skips builder image checks.
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "on: push",
          "jobs:",
          "  r64:",
          "    runs-on: ubuntu-latest",
          "    env:",
          "      IMAGE: node:24",
          "    steps:",
          "      - id: set",
          "        run: |",
          "          {",
          `            echo "IMAGE=node:24@${digest}"`,
          '            echo "debug" >&2',
          '          } >> "$GITHUB_ENV"',
          "          (",
          `            printf 'pinned=node:24@%s\\n' "${digest}"`,
          '            echo "unpinned=alpine:3.20"',
          '          ) >> "$GITHUB_OUTPUT"',
          '      - run: docker pull "$IMAGE"',
          '      - run: docker pull "${{ steps.set.outputs.pinned }}"',
          '      - run: docker pull "${{ steps.set.outputs.unpinned }}"',
          "      - run: |",
          "          docker build --build-arg BUILDKIT_SYNTAX=builtin - <<'EOF'",
          "          # syntax=builtin",
          `          FROM node:24@${digest}`,
          "          EOF",
          "      - run: docker buildx create --help",
          "",
        ].join("\n"),
      ),
    ).toEqual(["<memory>:20: alpine:3.20 is not pinned to a sha256 digest"]);
    // Non-shell `shell: python` steps fail closed when invoking container CLIs
    // (while benign Python steps pass), loop-carried mutations across
    // iterations are caught, multiline `GITHUB_ENV`/`GITHUB_OUTPUT` writes
    // split across commands are assembled, PowerShell bare-string and
    // `Write-Output` writes are decoded, and `2>>"$GITHUB_ENV"` stderr
    // redirections do not pollute tracked environment variables.
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "on: push",
          "jobs:",
          "  r65-posix:",
          "    runs-on: ubuntu-latest",
          "    env:",
          `      KEEP: node:24@${digest}`,
          "    steps:",
          "      - shell: python",
          '        run: print("hello")',
          "      - shell: python",
          "        run: |",
          "          import subprocess",
          '          subprocess.run(["docker", "pull", "node:24"], check=True)',
          "      - run: |",
          `          image=node:24@${digest}`,
          "          for arch in amd64 arm64; do",
          '            docker pull --platform="linux/$arch" "$image"',
          "            image=busybox:1.36",
          "          done",
          '          echo "KEEP=debian:12" 2>>"$GITHUB_ENV"',
          "      - id: multi",
          "        run: |",
          "          {",
          '            echo "ML_ENV<<EOF"',
          '            echo "ubuntu:24.04"',
          '            echo "EOF"',
          '          } >> "$GITHUB_ENV"',
          "          {",
          '            echo "ml_out<<END"',
          '            echo "nginx:1.27"',
          '            echo "END"',
          '          } >> "$GITHUB_OUTPUT"',
          '      - run: docker pull "$KEEP"',
          '      - run: docker pull "$ML_ENV"',
          '      - run: docker pull "${{ steps.multi.outputs.ml_out }}"',
          "  r65-win:",
          "    runs-on: windows-2025",
          "    steps:",
          "      - run: '\"PS_BARE=alpine:3.20\" >> $env:GITHUB_ENV'",
          "      - run: 'Write-Output \"PS_WRITE=fedora:41\" >> $env:GITHUB_ENV'",
          '      - run: docker pull "$env:PS_BARE"',
          '      - run: docker pull "$env:PS_WRITE"',
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "<memory>:12: container tool invocation in non-shell run step cannot be verified statically",
      "<memory>:18: busybox:1.36 is not pinned to a sha256 digest",
      "<memory>:25: ubuntu:24.04 is not pinned to a sha256 digest",
      "<memory>:35: nginx:1.27 is not pinned to a sha256 digest",
      "<memory>:39: alpine:3.20 is not pinned to a sha256 digest",
      "<memory>:40: fedora:41 is not pinned to a sha256 digest",
    ]);
    // Buildx action `with.build-args` and `with.build-contexts` expand env/matrix
    // expressions before splitting assignments, unconverged multi-hop loops fail
    // closed on affected image operands, and non-shell steps only fail when they
    // invoke a container tool or when their opaque output/env feeds an image.
    expect(
      unpinnedWorkflowContainerReferences(
        [
          "on: push",
          "jobs:",
          "  r66:",
          "    runs-on: ubuntu-latest",
          "    env:",
          "      BUILD_ARGS: |",
          "        BUILDKIT_SYNTAX=docker/dockerfile:1",
          "      BUILD_CONTEXTS: |",
          "        tools=docker-image://alpine:3.20",
          "    steps:",
          `      - uses: docker/build-push-action@${"b".repeat(40)}`,
          "        with:",
          "          build-args: ${{ env.BUILD_ARGS }}",
          "          build-contexts: ${{ env.BUILD_CONTEXTS }}",
          "      - id: benign_py",
          "        shell: python",
          "        run: |",
          "          # Mentions docker in a comment only",
          "          import os",
          '          open(os.environ["GITHUB_OUTPUT"], "a").write("count=5\\n")',
          '      - run: echo "count=${{ steps.benign_py.outputs.count }}"',
          "      - id: img_py",
          "        shell: python",
          "        run: |",
          "          import os",
          '          open(os.environ["GITHUB_OUTPUT"], "a").write("image=alpine:3.20\\n")',
          '      - run: docker pull "${{ steps.img_py.outputs.image }}"',
          "      - run: |",
          `          a=node:24@${digest}`,
          `          b=node:24@${digest}`,
          `          c=node:24@${digest}`,
          `          d=node:24@${digest}`,
          `          e=node:24@${digest}`,
          `          f=node:24@${digest}`,
          "          g=debian:12",
          "          for i in 1 2 3 4 5 6 7; do",
          '            docker pull "$a"',
          '            a="$b"; b="$c"; c="$d"; d="$e"; e="$f"; f="$g"',
          "          done",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "<memory>:9: alpine:3.20 is not pinned to a sha256 digest",
      "<memory>:13: docker/dockerfile:1 is not pinned to a sha256 digest",
      "<memory>:27: container image reference depends on an unverified non-shell output or environment variable",
      "<memory>:37: $a exceeds expansion limit and cannot be verified exhaustively",
    ]);
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
  });

  it("tracks digest-pinned container images in Renovate without drifting major/minor tags", async () => {
    const digest = `sha256:${"a".repeat(64)}`;
    // Renovate custom manager extracts the digest-pinned musl action images and
    // the BuildKit daemon image pinned in `publish-examples-container.yml`.
    const [renovateConfig, verifyMuslAction, publishExamples] = await Promise.all([
      readRepositoryFile("renovate.json").then(JSON.parse),
      readRepositoryFile(".github/actions/verify-musl-native/action.yml"),
      readRepositoryFile(".github/workflows/publish-examples-container.yml"),
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
    const publishExtracted = [...publishExamples.matchAll(pattern)].map((match) => ({
      depName: match.groups.depName,
      currentValue: match.groups.currentValue,
      hasDigest: /^sha256:[0-9a-f]{64}$/u.test(match.groups.currentDigest),
    }));
    expect(publishExtracted).toEqual([
      {
        depName: "moby/buildkit",
        currentValue: expect.stringMatching(/^v\d+\.\d+\.\d+$/u),
        hasDigest: true,
      },
    ]);
    const buildkitFixtureExtracted = [
      ...`image=moby/buildkit:v0.35.1@${digest}`.matchAll(pattern),
    ].map((match) => ({
      depName: match.groups.depName,
      currentValue: match.groups.currentValue,
      currentDigest: match.groups.currentDigest,
    }));
    expect(buildkitFixtureExtracted).toEqual([
      { depName: "moby/buildkit", currentValue: "v0.35.1", currentDigest: digest },
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
