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
      loadConfig: (options: { configPath?: string }) => Promise<T>
    ): Promise<T>
    loadConfigCachedSync<T>(
      configPath: string | undefined,
      loadConfig: (options: { configPath?: string }) => T
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
})

async function createConfigFile(contents: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "palamedes-config-cache-"))
  tempDirs.push(dir)
  const configPath = path.join(dir, "palamedes.yaml")
  await writeFile(configPath, contents)
  return configPath
}
