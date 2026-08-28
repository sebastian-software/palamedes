import { readFile, stat } from "node:fs/promises"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

import { selectScreenshotExamples } from "./example-matrix.mjs"

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
    const [ci, setupWorkspace] = await Promise.all([
      readRepositoryFile(".github/workflows/ci.yml"),
      readRepositoryFile(".github/actions/setup-workspace/action.yml"),
    ])
    const validate = job(ci, "validate", "validate-rust")

    expect(ci).toContain("permissions:\n  contents: read")
    expect(ci).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}")
    expect(validate).toContain("uses: ./.github/actions/setup-workspace")
    expect(setupWorkspace).toContain("node-version:")
    expect(setupWorkspace).toContain("pnpm-cache:")
    expect(setupWorkspace).toContain("rust:")
    expect(setupWorkspace).toContain("rust-cache:")
    expect(setupWorkspace).toContain("registry-url:")
    expect(setupWorkspace).toContain("cache: pnpm")
    expect(setupWorkspace).toContain("uses: Swatinem/rust-cache@v2")
    expect(setupWorkspace.indexOf("cache: pnpm")).toBeLessThan(
      setupWorkspace.indexOf("uses: Swatinem/rust-cache@v2")
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
    expect(validateRust).toContain("uses: ./.github/actions/setup-workspace")
    expect(validateRust).toContain("rust-toolchain: ${{ matrix.toolchain }}")
    expect(validateRust).toContain("rust-components: clippy, rustfmt")
    // Format and lint are platform-independent; only the tests fan out.
    expect(validateRust).toContain("if: ${{ matrix.lint }}")
    expect(toolchain).toContain('channel = "1.95"')
  })

  it("budgets both shipped native artifact families on the pinned toolchain", async () => {
    const [ci, binarySizeCheck] = await Promise.all([
      readRepositoryFile(".github/workflows/ci.yml"),
      readRepositoryFile("scripts/check-binary-size.mjs"),
    ])
    const validateRust = job(ci, "validate-rust")

    expect(validateRust).toContain("- name: Check shipped binary sizes")
    expect(validateRust).toContain("if: matrix.toolchain == '1.95'")
    expect(validateRust).toContain("run: node ./scripts/check-binary-size.mjs")
    expect(binarySizeCheck).toContain('crate: "palamedes-cli"')
    expect(binarySizeCheck).toContain('crate: "palamedes-node"')
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

  it("preflights x64 musl artifacts in CI with the release build and smoke commands", async () => {
    const [ci, publish, verifyMuslNative] = await Promise.all([
      readRepositoryFile(".github/workflows/ci.yml"),
      readRepositoryFile(".github/workflows/publish.yml"),
      readRepositoryFile(".github/actions/verify-musl-native/action.yml"),
    ])
    const validateMuslNative = job(ci, "validate-musl-native", "validate-rust")
    const publishNative = job(publish, "publish-native", "publish-js")

    expect(ci).toContain("pull_request:")
    expect(ci).toContain("- main")
    expect(validateMuslNative).toContain("runs-on: ubuntu-24.04")
    expect(validateMuslNative).toContain("permissions:\n      contents: read")
    expect(validateMuslNative).toContain('rust-cache: "false"')
    expect(validateMuslNative).toContain("run: pnpm install --frozen-lockfile")
    expect(validateMuslNative).not.toContain("publish-package-if-needed.mjs")
    for (const packageName of [
      "@palamedes/cli-linux-x64-musl",
      "@palamedes/core-node-linux-x64-musl",
    ]) {
      expect(validateMuslNative).toContain(`package_name: "${packageName}"`)
    }
    expect(validateMuslNative.indexOf("@palamedes/cli-linux-x64-musl")).toBeLessThan(
      validateMuslNative.indexOf("@palamedes/core-node-linux-x64-musl")
    )
    expect(validateMuslNative).toContain("uses: ./.github/actions/verify-musl-native")
    expect(publishNative).toContain("uses: ./.github/actions/verify-musl-native")
    expect(verifyMuslNative).toContain('rustup target add "${{ inputs.rust_target }}"')
    expect(verifyMuslNative).toContain('pnpm --filter "${{ inputs.package_name }}" build')
    expect(verifyMuslNative).toContain("rust:alpine")
    expect(verifyMuslNative).toContain("node:24-alpine")
    expect(verifyMuslNative).toContain("node ../core-node/scripts/build-native.mjs")
    expect(verifyMuslNative).toContain("execFileSync('./bin/pmds', ['version']")
  })

  it("caches Rust example builds and retries only scheduled browser verification", async () => {
    const [exampleVerification, browserConfig] = await Promise.all([
      readRepositoryFile(".github/workflows/example-verification.yml"),
      readRepositoryFile("vitest.examples.config.mjs"),
    ])

    expect(exampleVerification).toContain("uses: ./.github/actions/setup-workspace")
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
    expect(validateRelease).toContain("uses: ./.github/actions/setup-workspace")
    expect(validateRelease).toContain("run: pnpm test")
    expect(validateRelease).toContain("run: cargo test --workspace --locked")
    expect(publishNative).toMatch(/needs:\n(?:\s+- .+\n)*\s+- validate-release/m)
    expect(publishNative).toContain("ref: ${{ github.sha }}")
    expect(publishNative).toContain('rust-cache: "false"')
    expect(publishJs).toContain("ref: ${{ github.sha }}")
    expect(publishJs).toContain('rust-cache: "false"')
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

  it("surfaces first-publish setup in the full PR validation lane", async () => {
    const ci = await readRepositoryFile(".github/workflows/ci.yml")
    const validate = job(ci, "validate", "validate-rust")

    expect(validate).toContain("run: node ./scripts/check-first-publish.mjs --warn-only")
    expect(
      validate.indexOf("run: node ./scripts/check-first-publish.mjs --warn-only")
    ).toBeLessThan(validate.indexOf("run: pnpm install --frozen-lockfile"))
  })

  it("verifies the published release set and reports a failed publish", async () => {
    const publish = await readRepositoryFile(".github/workflows/publish.yml")
    const publishJs = job(publish, "publish-js", "verify-release")
    const verifyRelease = job(publish, "verify-release", "notify-failure")
    const notifyFailure = job(publish, "notify-failure", "__missing__")

    expect(verifyRelease).toMatch(/needs:\n(?:\s+- .+\n)*\s+- publish-js/m)
    expect(verifyRelease).toContain("run: node ./scripts/check-published-versions.mjs")
    expect(publishJs).toContain("publish-package-if-needed.mjs --all-js")
    expect(publishJs).not.toContain("publish_package @palamedes/")
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

  it("shares pinned release detection between package and container publishing", async () => {
    const [publish, container, releaseDetection] = await Promise.all([
      readRepositoryFile(".github/workflows/publish.yml"),
      readRepositoryFile(".github/workflows/publish-examples-container.yml"),
      readRepositoryFile("scripts/determine-release.mjs"),
    ])

    for (const [workflow, nextJob] of [
      [publish, "validate-release"],
      [container, "build-and-push"],
    ]) {
      const determineRelease = job(workflow, "determine-release", nextJob)
      expect(determineRelease).toContain("fetch-depth: 0")
      expect(determineRelease).toContain("ref: ${{ github.sha }}")
      expect(determineRelease).toContain("run: node ./scripts/determine-release.mjs")
      expect(determineRelease).toContain("BASE_REF: ${{ github.event.before }}")
    }
    expect(job(container, "build-and-push", "__missing__")).toContain("ref: ${{ github.sha }}")
    expect(releaseDetection).toContain("chore: release ")
    expect(releaseDetection).toContain("0000000000000000000000000000000000000000")
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

  it("offers every screenshot-capturable example in the capture dropdown", async () => {
    const capture = await readRepositoryFile(".github/workflows/capture-example-screenshots.yml")
    const options = Array.from(
      capture.slice(capture.indexOf("options:")).matchAll(/^ {10}- (\S+)$/gm),
      (match) => match[1]
    )

    // Workflow YAML cannot derive a choice list, so the matrix is the source of
    // truth and this is what notices when the two drift apart.
    expect(options).toEqual(["all", ...selectScreenshotExamples({}).map((example) => example.id)])
  })

  it("uses the shared workspace preamble and gives expensive jobs a deadline", async () => {
    const workflowPaths = [
      ".github/workflows/ci.yml",
      ".github/workflows/dependency-audit.yml",
      ".github/workflows/example-verification.yml",
      ".github/workflows/deploy-site.yml",
      ".github/workflows/capture-example-screenshots.yml",
      ".github/workflows/publish.yml",
    ]
    const workflows = await Promise.all(workflowPaths.map(readRepositoryFile))

    for (const workflow of workflows) {
      expect(workflow).toContain("uses: ./.github/actions/setup-workspace")
    }

    const [capture, publish] = [workflows[4], workflows[5]]
    expect(capture).toContain("timeout-minutes: 90")
    expect(job(publish, "publish-native", "publish-js")).toContain("timeout-minutes: 45")
    expect(job(publish, "publish-js", "verify-release")).toContain("timeout-minutes: 45")
  })

  it("verifies the built site before the deploy job publishes it", async () => {
    const [deploySite, packageJson] = await Promise.all([
      readRepositoryFile(".github/workflows/deploy-site.yml"),
      readRepositoryFile("package.json").then(JSON.parse),
    ])
    const build = job(deploySite, "build", "deploy")

    expect(packageJson.scripts["verify:site-routes"]).toBe("node ./scripts/verify-site-routes.mjs")
    expect(packageJson.scripts["verify:site-a11y"]).toBe("node ./scripts/verify-site-a11y.mjs")
    expect(build).toContain("run: pnpm verify:site-routes")
    expect(build).toContain("run: pnpm verify:site-a11y")
    // In the build job, so a dead route blocks the deploy rather than being
    // reported by the post-deploy curl checks after it is already live.
    expect(build.indexOf("run: pnpm build:site")).toBeLessThan(
      build.indexOf("run: pnpm verify:site-routes")
    )
    expect(build.indexOf("run: pnpm build:site")).toBeLessThan(
      build.indexOf("run: pnpm verify:site-a11y")
    )
    expect(build).toContain("run: pnpm exec playwright install --with-deps chromium")
  })

  it("keeps the frameworks live smoke probe independent of mutable page copy", async () => {
    const deploySite = await readRepositoryFile(".github/workflows/deploy-site.yml")
    const verify = job(deploySite, "verify", "__missing__")

    expect(verify).toMatch(/^ {10}check "\/frameworks" 200$/m)
  })

  it("maps every contributor-owned repository surface in CONTRIBUTING", async () => {
    const contributing = await readRepositoryFile("CONTRIBUTING.md")
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
    ]

    for (const repositoryPath of repositoryPaths) {
      expect((await stat(resolve(repositoryRoot, repositoryPath))).isDirectory()).toBe(true)
      expect(contributing).toContain(`\`${repositoryPath}\``)
    }
  })

  it("keeps the documented website workflow aligned with executable commands and paths", async () => {
    const [contributing, packageJson, sitePackageJson] = await Promise.all([
      readRepositoryFile("CONTRIBUTING.md"),
      readRepositoryFile("package.json").then(JSON.parse),
      readRepositoryFile("site/package.json").then(JSON.parse),
    ])

    expect(packageJson.scripts["dev:site"]).toBe("pnpm --filter @palamedes/site dev")
    expect(packageJson.scripts["build:site"]).toBe("pnpm --filter @palamedes/site build")
    expect(packageJson.scripts["verify:site-routes"]).toBe("node ./scripts/verify-site-routes.mjs")
    expect(packageJson.scripts["verify:site-a11y"]).toBe("node ./scripts/verify-site-a11y.mjs")
    expect(packageJson.scripts["verify:site-docs-dev"]).toBe(
      "node ./site/scripts/verify-docs-development.mjs"
    )
    expect(sitePackageJson.scripts.dev).toBe(
      "node ./scripts/prebuild-content.mjs && react-router dev --port 4100"
    )

    const buildSteps = [
      "node ../scripts/verify-site-bench-data.mjs",
      "node ../scripts/check-example-matrix.mjs",
      "node ../scripts/verify-site-editorial-rails.mjs",
      "node ../scripts/verify-site-streamline-assets.mjs",
      "node ./scripts/generate-og-images.mjs --check",
      "node ./scripts/prebuild-content.mjs",
      "react-router build",
      "node ../scripts/copy-llms-to-site.mjs",
    ]
    let previousBuildStep = -1
    for (const buildStep of buildSteps) {
      const index = sitePackageJson.scripts.build.indexOf(buildStep)
      expect(index).toBeGreaterThan(previousBuildStep)
      previousBuildStep = index
    }

    const documentedCommands = [
      "pnpm dev:site",
      "pnpm build:site",
      "pnpm verify:site-routes",
      "pnpm verify:site-a11y",
      "pnpm verify:site-docs-dev",
    ]
    let previousCommand = -1
    for (const command of documentedCommands) {
      const index = contributing.indexOf(command)
      expect(index).toBeGreaterThan(previousCommand)
      previousCommand = index
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
      expect(contributing).toContain(`\`${documentedPath}\``)
    }
    expect(contributing).toContain("http://localhost:4100")
    expect(contributing).toContain("pnpm exec playwright install chromium")
  })

  it("checks cold-cache docs navigation on the full pull-request job", async () => {
    const [ci, packageJson] = await Promise.all([
      readRepositoryFile(".github/workflows/ci.yml"),
      readRepositoryFile("package.json").then(JSON.parse),
    ])
    const validate = job(ci, "validate", "validate-rust")

    expect(packageJson.scripts["verify:site-docs-dev"]).toBe(
      "node ./site/scripts/verify-docs-development.mjs"
    )
    expect(validate).toContain("run: pnpm verify:site-docs-dev")
    expect(validate.indexOf("run: pnpm build:site")).toBeLessThan(
      validate.indexOf("run: pnpm verify:site-docs-dev")
    )
  })
})
