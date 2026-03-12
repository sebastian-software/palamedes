import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import os from "node:os"

import { afterEach, describe, expect, it } from "vitest"

import { loadPalamedesConfig } from "./index"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true })
    })
  )
})

describe("loadPalamedesConfig", () => {
  it("loads a palamedes.config.ts file from the current directory tree", async () => {
    const fixtureDir = await createTempDir()
    const nestedDir = path.join(fixtureDir, "apps", "web")

    await mkdir(nestedDir, { recursive: true })
    await writeFile(
      path.join(fixtureDir, "palamedes.config.ts"),
      `
        export default {
          locales: ["en", "de"],
          sourceLocale: "en",
          catalogs: [
            {
              path: "src/locales/{locale}",
              include: ["src"],
            },
          ],
        }
      `
    )

    const config = await loadPalamedesConfig({ cwd: nestedDir })

    expect(config.rootDir).toBe(fixtureDir)
    expect(config.sourceLocale).toBe("en")
    expect(config.catalogs[0]?.path).toBe("src/locales/{locale}")
  })

  it("loads an explicitly provided config path", async () => {
    const fixtureDir = await createTempDir()
    const configPath = path.join(fixtureDir, "custom.config.ts")

    await writeFile(
      configPath,
      `
        export default {
          locales: ["en"],
          sourceLocale: "en",
          pseudoLocale: "pseudo",
          catalogs: [
            {
              path: "messages/{locale}",
              include: ["src"],
              exclude: ["src/ignore"],
            },
          ],
        }
      `
    )

    const config = await loadPalamedesConfig({
      cwd: fixtureDir,
      configPath: "./custom.config.ts",
    })

    expect(config.configPath).toBe(configPath)
    expect(config.pseudoLocale).toBe("pseudo")
    expect(config.catalogs[0]?.exclude).toEqual(["src/ignore"])
  })

  it("fails validation for invalid config shapes", async () => {
    const fixtureDir = await createTempDir()
    await writeFile(
      path.join(fixtureDir, "palamedes.config.js"),
      `
        module.exports = {
          locales: ["de"],
          sourceLocale: "en",
          catalogs: [],
        }
      `
    )

    await expect(loadPalamedesConfig({ cwd: fixtureDir })).rejects.toThrow(
      /"sourceLocale" must be included in "locales"/
    )
  })
})

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "palamedes-config-"))
  tempDirs.push(dir)
  return dir
}
