import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

const repositoryRoot = resolve(import.meta.dirname, "..")

async function readRepositoryFile(path) {
  return readFile(resolve(repositoryRoot, path), "utf8")
}

function job(workflow, name, nextName) {
  const start = workflow.indexOf(`  ${name}:`)
  const next = workflow.indexOf(`  ${nextName}:`, start + 1)
  const end = next === -1 ? workflow.length : next

  if (start === -1) {
    throw new Error(`Could not find ${name} job boundary`)
  }

  return workflow.slice(start, end)
}

describe("workflow contracts", () => {
  it("keeps pure-JS container contracts in the full test gate", async () => {
    const [packageJson, ci] = await Promise.all([
      readRepositoryFile("package.json").then(JSON.parse),
      readRepositoryFile(".github/workflows/ci.yml"),
    ])

    expect(packageJson.scripts.test).toContain("pnpm check:example-contracts")
    expect(packageJson.scripts.test).toContain("pnpm check:workflow-contracts")
    expect(packageJson.scripts["check:example-contracts"]).toContain(
      "scripts/container/start-plan.test.mjs"
    )
    expect(ci).toContain("run: pnpm test")
  })

  it("runs path-sensitive and published-consumer package tests on each non-Linux validation leg", async () => {
    const [ci, packageJson, nextPlugin, tanstack, vitePlugin] = await Promise.all([
      readRepositoryFile(".github/workflows/ci.yml"),
      readRepositoryFile("package.json").then(JSON.parse),
      readRepositoryFile("packages/next-plugin/package.json").then(JSON.parse),
      readRepositoryFile("packages/tanstack/package.json").then(JSON.parse),
      readRepositoryFile("packages/vite-plugin/package.json").then(JSON.parse),
    ])

    expect(ci).toContain("- os: macos-14")
    expect(ci).toContain("- os: windows-2025")
    expect(ci).toContain("- name: Test path-sensitive packages")
    expect(ci).toContain("if: ${{ !matrix.full }}")
    expect(ci).toContain("run: pnpm test:platform")
    expect(packageJson.scripts["test:platform"]).toContain("--filter @palamedes/config")
    expect(packageJson.scripts["test:platform"]).toContain("--filter @palamedes/core-node")
    expect(packageJson.scripts["test:platform"]).toContain("--filter @palamedes/next-plugin")
    expect(packageJson.scripts["test:platform"]).toContain("--filter @palamedes/tanstack")
    expect(packageJson.scripts["test:platform"]).toContain("--filter @palamedes/vite-plugin")
    expect(nextPlugin.scripts.test).toBe("vitest run --globals")
    expect(tanstack.scripts.test).toContain("scripts/package.test.mjs")
    expect(vitePlugin.scripts.test).toBe("vitest run --globals")
  })

  it("keeps the hot CI lane cancellable, least-privileged, and cached", async () => {
    const ci = await readRepositoryFile(".github/workflows/ci.yml")
    const validate = job(ci, "validate", "validate-rust")

    expect(ci).toContain("permissions:\n  contents: read")
    expect(ci).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}")
    // Both caches sit in the validate job because `pnpm build` drives cargo.
    expect(validate).toContain("cache: pnpm")
    expect(validate).toContain("uses: Swatinem/rust-cache@v2")
    expect(validate.indexOf("uses: Swatinem/rust-cache@v2")).toBeLessThan(
      validate.indexOf("run: pnpm install --frozen-lockfile")
    )
  })

  it("runs the Rust workspace tests on every shipped host platform", async () => {
    const [ci, toolchain] = await Promise.all([
      readRepositoryFile(".github/workflows/ci.yml"),
      readRepositoryFile("rust-toolchain.toml"),
    ])
    const validateRust = job(ci, "validate-rust")

    for (const os of ["ubuntu-24.04", "windows-2025", "macos-14"]) {
      expect(validateRust).toContain(`- os: ${os}`)
    }
    expect(validateRust).toContain("run: cargo test --workspace --locked")
    // Format and lint are platform-independent; only the tests fan out.
    expect(validateRust).toContain("if: ${{ matrix.lint }}")
    expect(toolchain).toContain('channel = "1.95"')
  })

  it("runs the React Router RSC request-isolation proof on Linux", async () => {
    const ci = await readRepositoryFile(".github/workflows/ci.yml")
    const validate = job(ci, "validate", "validate-rust")

    expect(ci).toContain("- name: Verify React Router RSC request scope")
    expect(ci).toContain("if: matrix.os == 'ubuntu-24.04' && matrix.node == 24")
    expect(ci).toContain("run: pnpm verify:react-router-rsc")
    expect(validate).toContain("- name: Install Playwright Chromium")
    expect(validate.indexOf("run: pnpm exec playwright install --with-deps chromium")).toBeLessThan(
      validate.indexOf("run: pnpm verify:react-router-rsc")
    )
  })

  it("caches Rust example builds and retries only scheduled browser verification", async () => {
    const [exampleVerification, browserConfig] = await Promise.all([
      readRepositoryFile(".github/workflows/example-verification.yml"),
      readRepositoryFile("vitest.examples.config.mjs"),
    ])

    expect(exampleVerification).toContain("- name: Cache Rust build artifacts")
    expect(exampleVerification).toContain("uses: Swatinem/rust-cache@v2")
    expect(exampleVerification).toContain(
      "PALAMEDES_BROWSER_RETRY: ${{ github.event_name == 'schedule' && '1' || '0' }}"
    )
    expect(browserConfig).toContain('retry: process.env.PALAMEDES_BROWSER_RETRY === "1" ? 1 : 0')
  })

  it("requires locked Rust workspace tests before any release publishing", async () => {
    const publish = await readRepositoryFile(".github/workflows/publish.yml")
    const validateRelease = job(publish, "validate-release", "publish-native")
    const publishNative = job(publish, "publish-native", "publish-js")
    const publishJs = job(publish, "publish-js", "__missing__")

    expect(validateRelease).toContain("ref: ${{ github.sha }}")
    expect(validateRelease).toContain("uses: Swatinem/rust-cache@v2")
    expect(validateRelease).toContain("run: pnpm test")
    expect(validateRelease).toContain("run: cargo test --workspace --locked")
    expect(publishNative).toMatch(/needs:\n(?:\s+- .+\n)*\s+- validate-release/m)
    expect(publishNative).toContain("ref: ${{ github.sha }}")
    expect(publishJs).toContain("ref: ${{ github.sha }}")
    expect(publishJs).toContain("- name: Materialize pinned Rust toolchain")
    expect(publishJs.indexOf("run: cargo --version")).toBeLessThan(
      publishJs.indexOf("- name: Build publishable packages")
    )
  })

  it("stops a release before publishing anything when a package needs a first publish", async () => {
    const publish = await readRepositoryFile(".github/workflows/publish.yml")
    const validateRelease = job(publish, "validate-release", "publish-native")

    expect(validateRelease).toContain("run: node ./scripts/check-first-publish.mjs")
    // Before the build, so the check costs seconds rather than a full release gate.
    expect(validateRelease.indexOf("run: node ./scripts/check-first-publish.mjs")).toBeLessThan(
      validateRelease.indexOf("run: pnpm build")
    )
  })

  it("verifies the published release set and reports a failed publish", async () => {
    const publish = await readRepositoryFile(".github/workflows/publish.yml")
    const verifyRelease = job(publish, "verify-release", "notify-failure")
    const notifyFailure = job(publish, "notify-failure", "__missing__")

    expect(verifyRelease).toMatch(/needs:\n(?:\s+- .+\n)*\s+- publish-js/m)
    expect(verifyRelease).toContain("run: node ./scripts/check-published-versions.mjs")
    expect(notifyFailure).toContain("issues: write")
    expect(notifyFailure).toContain("failure()")
    expect(notifyFailure).toContain("scripts/open-or-refresh-issue.mjs")
    for (const jobName of [
      "determine-release",
      "validate-release",
      "publish-native",
      "publish-js",
      "verify-release",
    ]) {
      expect(notifyFailure).toContain(`needs.${jobName}.result`)
    }
  })

  it("filters the umbrella package by directory so the workspace root cannot match", async () => {
    const [publish, rootPackageJson, umbrellaPackageJson] = await Promise.all([
      readRepositoryFile(".github/workflows/publish.yml"),
      readRepositoryFile("package.json").then(JSON.parse),
      readRepositoryFile("packages/palamedes/package.json").then(JSON.parse),
    ])

    // The guard only matters while these two share a name; check-release-set.mjs
    // rejects any ambiguous name filter, and this pins the known collision.
    expect(rootPackageJson.name).toBe(umbrellaPackageJson.name)
    expect(publish).toContain("--filter ./packages/palamedes")
    expect(publish).not.toMatch(/--filter palamedes\s*$/m)
  })

  it("keeps the publish lanes least-privileged", async () => {
    const [publish, container] = await Promise.all([
      readRepositoryFile(".github/workflows/publish.yml"),
      readRepositoryFile(".github/workflows/publish-examples-container.yml"),
    ])

    expect(publish).toContain("permissions:\n  contents: read")
    expect(container).toContain("permissions:\n  contents: read")
  })

  it("lets the dependency audit exit code reach the tracking issue step", async () => {
    const dependencyAudit = await readRepositoryFile(".github/workflows/dependency-audit.yml")

    // `|| true` here would pin both step outcomes to success and make the issue
    // step below permanently unreachable.
    expect(dependencyAudit).not.toContain("pnpm audit --audit-level=high 2>&1 || true")
    expect(dependencyAudit).not.toContain("cargo audit 2>&1 || true")
    expect(dependencyAudit).toContain(
      "pnpm audit --audit-level=high >> audit-report.md 2>&1 || status=$?"
    )
    expect(dependencyAudit).toContain("cargo audit >> audit-report.md 2>&1 || status=$?")
    expect(dependencyAudit).toContain(
      "if: steps.npm-audit.outcome == 'failure' || steps.cargo-audit.outcome == 'failure'"
    )
    expect(dependencyAudit).toContain("scripts/open-or-refresh-issue.mjs")
  })
})
