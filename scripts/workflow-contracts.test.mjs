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
})
