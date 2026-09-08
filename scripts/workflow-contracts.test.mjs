import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { checkWorkflowPins, unpinnedActionReferences } from "./check-workflow-pins.mjs";
import { COVERAGE_GATES } from "./coverage-gate.mjs";
import { selectScreenshotExamples } from "./example-matrix.mjs";
import {
  assertEnabledCacheContents,
  assertNetworkIsolation,
} from "./check-enabled-update-check.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

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

describe("workflow contracts", () => {
  it("validates the enabled control's newline-terminated Rust cache files", () => {
    expect(() => assertEnabledCacheContents("1788773977\n", "2026-09\n")).not.toThrow();
    for (const timestamp of ["1788773977", "1788773977\n\n", "1788773977\r\n", "invalid\n", ""]) {
      expect(() => assertEnabledCacheContents(timestamp, "2026-09\n")).toThrow();
    }
    for (const cohort of ["2026-09", "2026-09\n\n", "2026-09\r\n", "2026-09-07\n", ""]) {
      expect(() => assertEnabledCacheContents("1788773977\n", cohort)).toThrow();
    }
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
      /^ {4}env:\n(?: {6}.+\n)* {6}PALAMEDES_UPDATE_ENDPOINT: https:\/\/version-service\.sebastian-software\.de\/check$/mu,
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
    expect(ciProof).toContain("if: matrix.os == 'ubuntu-24.04' && matrix.toolchain == '1.95'");
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
    const [ci, packageJson, nextPlugin, tanstack, vitePlugin] = await Promise.all([
      readRepositoryFile(".github/workflows/ci.yml"),
      readRepositoryFile("package.json").then(JSON.parse),
      readRepositoryFile("packages/next-plugin/package.json").then(JSON.parse),
      readRepositoryFile("packages/tanstack/package.json").then(JSON.parse),
      readRepositoryFile("packages/vite-plugin/package.json").then(JSON.parse),
    ]);

    expect(ci).toContain("- os: macos-14");
    expect(ci).toContain("- os: windows-2025");
    expect(ci).toContain("- name: Test path-sensitive packages");
    expect(ci).toContain("if: ${{ !matrix.full }}");
    expect(ci).toContain("run: pnpm test:platform");
    expect(packageJson.scripts["test:platform"]).toContain("--filter @palamedes/config");
    expect(packageJson.scripts["test:platform"]).toContain("--filter @palamedes/core-node");
    expect(packageJson.scripts["test:platform"]).toContain("--filter @palamedes/next-plugin");
    expect(packageJson.scripts["test:platform"]).toContain("--filter @palamedes/tanstack");
    expect(packageJson.scripts["test:platform"]).toContain("--filter @palamedes/vite-plugin");
    expect(nextPlugin.scripts.test).toBe("vitest run --globals");
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

    for (const os of ["ubuntu-24.04", "windows-2025", "macos-14"]) {
      expect(validateRust).toContain(`- os: ${os}`);
    }
    expect(validateRust).toContain("run: cargo test --workspace --locked");
    expect(validateRust).toContain("uses: ./.github/actions/setup-workspace");
    expect(validateRust).toContain("rust-toolchain: ${{ matrix.toolchain }}");
    expect(validateRust).toContain("rust-components: clippy, rustfmt");
    // Format and lint are platform-independent; only the tests fan out.
    expect(validateRust).toContain("if: ${{ matrix.lint }}");
    expect(toolchain).toContain('channel = "1.95"');
  });

  it("budgets both shipped native artifact families on the pinned toolchain", async () => {
    const [ci, binarySizeCheck] = await Promise.all([
      readRepositoryFile(".github/workflows/ci.yml"),
      readRepositoryFile("scripts/check-binary-size.mjs"),
    ]);
    const validateRust = job(ci, "validate-rust");

    expect(validateRust).toContain("- name: Check shipped binary sizes");
    expect(validateRust).toContain("if: matrix.toolchain == '1.95'");
    expect(validateRust).toContain("run: node ./scripts/check-binary-size.mjs");
    expect(binarySizeCheck).toContain('crate: "palamedes-cli"');
    expect(binarySizeCheck).toContain('crate: "palamedes-node"');
  });

  it("runs the React Router RSC request-isolation proof on Linux", async () => {
    const ci = await readRepositoryFile(".github/workflows/ci.yml");
    const validate = job(ci, "validate", "validate-rust");

    expect(ci).toContain("- name: Verify React Router RSC request scope");
    expect(ci).toContain("if: matrix.os == 'ubuntu-24.04' && matrix.node == 24");
    expect(ci).toContain("run: pnpm verify:react-router-rsc");
    expect(validate).toContain("- name: Install Playwright Chromium");
    expect(validate.indexOf("run: pnpm exec playwright install --with-deps chromium")).toBeLessThan(
      validate.indexOf("run: pnpm verify:react-router-rsc"),
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
    expect(verifyMuslNative).toContain("rust:1.95-alpine");
    expect(verifyMuslNative).toContain("node:24-alpine");
    expect(verifyMuslNative).toContain("node ../core-node/scripts/build-native.mjs");
    expect(verifyMuslNative).toContain("execFileSync('./bin/pmds', ['version']");
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
    const verifyRelease = job(publish, "verify-release", "notify-failure");
    const notifyFailure = job(publish, "notify-failure", "__missing__");

    expect(verifyRelease).toMatch(/needs:\n(?:\s+- .+\n)*\s+- publish-js/m);
    expect(verifyRelease).toContain("run: node ./scripts/check-published-versions.mjs");
    expect(verifyRelease).toContain("timeout-minutes: 15");
    expect(verifyRelease).toContain("PALAMEDES_REGISTRY_RETRY_BUDGET_MS: 300000");
    expect(verifyRelease).toContain("PALAMEDES_REGISTRY_RETRY_MS: 15000");
    expect(publishJs).toContain("publish-package-if-needed.mjs --all-js");
    expect(publishJs).not.toContain("publish_package @palamedes/");
    expect(notifyFailure).toContain("issues: write");
    expect(notifyFailure).toContain("failure()");
    expect(notifyFailure).toContain("scripts/open-or-refresh-issue.mjs");
    for (const jobName of [
      "determine-release",
      "validate-release",
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

  it("shares pinned release detection between package and container publishing", async () => {
    const [publish, container, releaseDetection] = await Promise.all([
      readRepositoryFile(".github/workflows/publish.yml"),
      readRepositoryFile(".github/workflows/publish-examples-container.yml"),
      readRepositoryFile("scripts/determine-release.mjs"),
    ]);

    for (const [workflow, nextJob] of [
      [publish, "validate-release"],
      [container, "build-and-push"],
    ]) {
      const determineRelease = job(workflow, "determine-release", nextJob);
      expect(determineRelease).toContain("fetch-depth: 0");
      expect(determineRelease).toContain("ref: ${{ github.sha }}");
      expect(determineRelease).toContain("run: node ./scripts/determine-release.mjs");
      expect(determineRelease).toContain("BASE_REF: ${{ github.event.before }}");
    }
    expect(job(container, "build-and-push", "__missing__")).toContain("ref: ${{ github.sha }}");
    expect(releaseDetection).toContain("chore: release ");
    expect(releaseDetection).toContain("0000000000000000000000000000000000000000");
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
