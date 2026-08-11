import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

const repositoryRoot = resolve(import.meta.dirname, "..")
const nativePackageDirectories = [
  "cli-darwin-arm64",
  "cli-linux-arm64-gnu",
  "cli-linux-arm64-musl",
  "cli-linux-x64-gnu",
  "cli-linux-x64-musl",
  "cli-win32-x64-msvc",
  "core-node-darwin-arm64",
  "core-node-linux-arm64-gnu",
  "core-node-linux-arm64-musl",
  "core-node-linux-x64-gnu",
  "core-node-linux-x64-musl",
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
})
