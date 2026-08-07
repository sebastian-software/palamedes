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

  it("runs path-sensitive package tests on each non-Linux validation leg", async () => {
    const [ci, packageJson, nextPlugin, vitePlugin] = await Promise.all([
      readRepositoryFile(".github/workflows/ci.yml"),
      readRepositoryFile("package.json").then(JSON.parse),
      readRepositoryFile("packages/next-plugin/package.json").then(JSON.parse),
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
    expect(packageJson.scripts["test:platform"]).toContain("--filter @palamedes/vite-plugin")
    expect(nextPlugin.scripts.test).toBe("vitest run --globals")
    expect(vitePlugin.scripts.test).toBe("vitest run --globals")
  })

  it("requires locked Rust workspace tests before any release publishing", async () => {
    const publish = await readRepositoryFile(".github/workflows/publish.yml")
    const validateRelease = job(publish, "validate-release", "publish-native")
    const publishNative = job(publish, "publish-native", "publish-js")

    expect(validateRelease).toContain("ref: ${{ github.sha }}")
    expect(validateRelease).toContain("uses: Swatinem/rust-cache@v2")
    expect(validateRelease).toContain("run: pnpm test")
    expect(validateRelease).toContain("run: cargo test --workspace --locked")
    expect(publishNative).toMatch(/needs:\n(?:\s+- .+\n)*\s+- validate-release/m)
    expect(publishNative).toContain("ref: ${{ github.sha }}")
    expect(job(publish, "publish-js", "__missing__")).toContain("ref: ${{ github.sha }}")
  })
})
