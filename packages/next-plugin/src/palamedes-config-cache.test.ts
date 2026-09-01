import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

const require = createRequire(import.meta.url)
const { clearConfigCache, loadConfigCached, loadConfigCachedSync } =
  require("../palamedes-config-cache.cjs") as {
    clearConfigCache(): void
    loadConfigCached<T>(
      configPath: string | undefined,
      loadConfig: (options: { configPath?: string; cwd?: string }) => Promise<T>,
      cwd?: string
    ): Promise<T>
    loadConfigCachedSync<T>(
      configPath: string | undefined,
      loadConfig: (options: { configPath?: string; cwd?: string }) => T,
      cwd?: string
    ): T
  }

const tempDirs: string[] = []

afterEach(async () => {
  clearConfigCache()
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
})

describe("palamedes-config-cache.cjs", () => {
  it("shares a digest-validated entry between sync and async loaders", async () => {
    const configPath = await createConfigFile("first")
    const config = { configPath, value: "first" }
    const loadSync = vi.fn(() => config)
    const loadAsync = vi.fn(async () => ({ configPath, value: "unexpected" }))

    expect(loadConfigCachedSync(configPath, loadSync)).toBe(config)
    await expect(loadConfigCached(configPath, loadAsync)).resolves.toBe(config)
    expect(loadSync).toHaveBeenCalledOnce()
    expect(loadAsync).not.toHaveBeenCalled()
  })

  it("reloads when the config file content changes", async () => {
    const configPath = await createConfigFile("first")
    const first = { configPath, value: "first" }
    const second = { configPath, value: "second" }
    loadConfigCachedSync(configPath, () => first)
    await writeFile(configPath, "second")
    const loadAsync = vi.fn(async () => second)

    await expect(loadConfigCached(configPath, loadAsync)).resolves.toBe(second)
    expect(loadAsync).toHaveBeenCalledOnce()
  })

  it("reloads when an imported config dependency changes", async () => {
    const configPath = await createConfigFile("unchanged config")
    const dependencyPath = path.join(path.dirname(configPath), "settings.ts")
    await writeFile(dependencyPath, 'export const locale = "de"')
    const first = {
      configDependencies: [configPath, dependencyPath],
      configPath,
      value: "de",
    }
    const second = {
      configDependencies: [configPath, dependencyPath],
      configPath,
      value: "fr",
    }
    loadConfigCachedSync(configPath, () => first)

    await writeFile(dependencyPath, 'export const locale = "fr"')
    const loadAsync = vi.fn(async () => second)

    await expect(loadConfigCached(configPath, loadAsync)).resolves.toBe(second)
    expect(loadAsync).toHaveBeenCalledOnce()
  })

  it("does not share automatic config discovery between Next project roots", async () => {
    const firstRoot = await mkdtemp(path.join(os.tmpdir(), "palamedes-next-app-a-"))
    const secondRoot = await mkdtemp(path.join(os.tmpdir(), "palamedes-next-app-b-"))
    tempDirs.push(firstRoot, secondRoot)
    const firstPath = path.join(firstRoot, "palamedes.yaml")
    const secondPath = path.join(secondRoot, "palamedes.yaml")
    await Promise.all([writeFile(firstPath, "first"), writeFile(secondPath, "second")])
    const loadConfig = vi.fn(({ cwd }: { cwd?: string }) =>
      cwd === firstRoot
        ? { configPath: firstPath, value: "first" }
        : { configPath: secondPath, value: "second" }
    )

    expect(loadConfigCachedSync(undefined, loadConfig, firstRoot)).toMatchObject({ value: "first" })
    expect(loadConfigCachedSync(undefined, loadConfig, secondRoot)).toMatchObject({
      value: "second",
    })
    expect(loadConfig).toHaveBeenCalledTimes(2)
  })
})

async function createConfigFile(contents: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "palamedes-config-cache-"))
  tempDirs.push(dir)
  const configPath = path.join(dir, "palamedes.yaml")
  await writeFile(configPath, contents)
  return configPath
}
