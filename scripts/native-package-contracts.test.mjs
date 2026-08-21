import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

const repositoryRoot = resolve(import.meta.dirname, "..")
const nativePackageDirectories = [
  "cli-darwin-arm64",
  "cli-darwin-x64",
  "cli-linux-arm64-gnu",
  "cli-linux-arm64-musl",
  "cli-linux-x64-gnu",
  "cli-linux-x64-musl",
  "cli-win32-arm64-msvc",
  "cli-win32-x64-msvc",
  "core-node-darwin-arm64",
  "core-node-darwin-x64",
  "core-node-linux-arm64-gnu",
  "core-node-linux-arm64-musl",
  "core-node-linux-x64-gnu",
  "core-node-linux-x64-musl",
  "core-node-win32-arm64-msvc",
  "core-node-win32-x64-msvc",
]

describe("native platform package contracts", () => {
  it("guards the artifact of every platform package before npm publish", async () => {
    const packages = await Promise.all(
      nativePackageDirectories.map(async (directory) => ({
        directory,
        packageJson: JSON.parse(
          await readFile(resolve(repositoryRoot, "packages", directory, "package.json"), "utf8")
        ),
      }))
    )

    for (const { directory, packageJson } of packages) {
      expect(packageJson.scripts.prepublishOnly, directory).toBe(
        "node ../../scripts/assert-native-artifact.mjs"
      )
      expect(packageJson.scripts.build, directory).toContain("--if-compatible")
    }
  })

  it("keeps the platform-support page aligned with published packages, resolvers, wrapper dependencies, and navigation", async () => {
    const targets = [
      { suffix: "darwin-arm64", os: "darwin", host: "macOS", cpu: "arm64", libc: null },
      { suffix: "darwin-x64", os: "darwin", host: "macOS", cpu: "x64", libc: null },
      { suffix: "linux-x64-gnu", os: "linux", host: "Linux", cpu: "x64", libc: "glibc" },
      { suffix: "linux-x64-musl", os: "linux", host: "Linux", cpu: "x64", libc: "musl" },
      { suffix: "linux-arm64-gnu", os: "linux", host: "Linux", cpu: "arm64", libc: "glibc" },
      { suffix: "linux-arm64-musl", os: "linux", host: "Linux", cpu: "arm64", libc: "musl" },
      { suffix: "win32-x64-msvc", os: "win32", host: "Windows", cpu: "x64", libc: null },
      {
        suffix: "win32-arm64-msvc",
        os: "win32",
        host: "Windows",
        cpu: "arm64",
        libc: null,
      },
    ]
    const [
      page,
      cliResolver,
      bindingResolver,
      coreNodeManifest,
      publishWorkflow,
      navigation,
      contributorGuide,
      ...manifests
    ] = await Promise.all([
      readFile(resolve(repositoryRoot, "docs/platform-support.md"), "utf8"),
      readFile(resolve(repositoryRoot, "packages/cli/scripts/platform.mjs"), "utf8"),
      readFile(resolve(repositoryRoot, "packages/core-node/src/native-loader.ts"), "utf8"),
      readFile(resolve(repositoryRoot, "packages/core-node/package.json"), "utf8"),
      readFile(resolve(repositoryRoot, ".github/workflows/publish.yml"), "utf8"),
      readFile(resolve(repositoryRoot, "site/scripts/prebuild-content.mjs"), "utf8"),
      readFile(resolve(repositoryRoot, "CONTRIBUTING.md"), "utf8"),
      ...targets.flatMap(({ suffix }) => [
        readFile(resolve(repositoryRoot, `packages/cli-${suffix}/package.json`), "utf8"),
        readFile(resolve(repositoryRoot, `packages/core-node-${suffix}/package.json`), "utf8"),
      ]),
    ])

    const rows = page
      .split("\n")
      .filter(
        (line) =>
          line.startsWith("| `") &&
          line.includes("`@palamedes/cli-") &&
          line.includes("`@palamedes/core-node-")
      )
    expect(rows).toHaveLength(8)
    expect(page).toContain("An x64 Node process on an Intel Mac or under Rosetta")
    expect(page).toContain("Windows on ARM is supported")
    expect(navigation).toContain('["platform-support.md", 15]')
    expect(contributorGuide).toContain("ships prebuilt binaries for eight platforms")
    const coreNodeOptionalDependencies = JSON.parse(coreNodeManifest).optionalDependencies
    expect(new Set(Object.keys(coreNodeOptionalDependencies))).toEqual(
      new Set(targets.map(({ suffix }) => `@palamedes/core-node-${suffix}`))
    )

    for (const [index, target] of targets.entries()) {
      const cliPackage = `@palamedes/cli-${target.suffix}`
      const bindingPackage = `@palamedes/core-node-${target.suffix}`
      const rowPattern = [
        "^\\|\\s*`",
        target.os,
        "`\\s*\\|\\s*",
        target.host,
        "\\s*\\|\\s*",
        target.cpu,
        "\\s*\\|\\s*",
        target.libc ?? "Not applicable",
        "\\s*\\|\\s*`",
        cliPackage,
        "`\\s*\\|\\s*`",
        bindingPackage,
        "`\\s*\\|$",
      ].join("")
      expect(page).toMatch(new RegExp(rowPattern, "mu"))
      expect(cliResolver).toContain(cliPackage)
      expect(bindingResolver).toContain(bindingPackage)
      expect(coreNodeOptionalDependencies).toHaveProperty(bindingPackage)
      expect(publishWorkflow).toContain(`package_name: "${cliPackage}"`)
      expect(publishWorkflow).toContain(`package_name: "${bindingPackage}"`)

      const [cliManifest, bindingManifest] = manifests
        .slice(index * 2, index * 2 + 2)
        .map(JSON.parse)
      expect(cliManifest.name).toBe(cliPackage)
      expect(bindingManifest.name).toBe(bindingPackage)
      expect(cliManifest.os).toEqual([target.os])
      expect(bindingManifest.os).toEqual([target.os])
      expect(cliManifest.cpu).toEqual([target.cpu])
      expect(bindingManifest.cpu).toEqual([target.cpu])
      expect(cliManifest.libc ?? null).toEqual(target.libc ? [target.libc] : null)
      expect(bindingManifest.libc ?? null).toEqual(target.libc ? [target.libc] : null)
    }
  })

  it("builds Intel macOS and Windows ARM artifacts on matching native runners", async () => {
    const [ciWorkflow, publishWorkflow] = await Promise.all([
      readFile(resolve(repositoryRoot, ".github/workflows/ci.yml"), "utf8"),
      readFile(resolve(repositoryRoot, ".github/workflows/publish.yml"), "utf8"),
    ])
    const targets = [
      {
        runner: "macos-15-intel",
        packages: ["@palamedes/core-node-darwin-x64", "@palamedes/cli-darwin-x64"],
      },
      {
        runner: "windows-11-arm",
        packages: ["@palamedes/core-node-win32-arm64-msvc", "@palamedes/cli-win32-arm64-msvc"],
      },
    ]

    for (const { runner, packages } of targets) {
      expect(ciWorkflow).toContain(`- os: ${runner}`)
      for (const packageName of packages) {
        expect(publishWorkflow).toMatch(
          new RegExp(`package_name: "${packageName}"\\n\\s+runner: ${runner}`, "u")
        )
      }
    }
  })
})
