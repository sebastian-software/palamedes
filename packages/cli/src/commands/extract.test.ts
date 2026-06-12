import { cp, mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { parsePo } from "@palamedes/core-node"

import { extract } from "./extract"

const FIXTURE_DIR = path.resolve(import.meta.dirname, "fixtures/ferrocat-first-test")

const tempDirs: string[] = []

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(async () => {
  vi.restoreAllMocks()
  delete process.env.PALAMEDES_TIMING_JSON

  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true })
    })
  )
})

describe("extract", () => {
  it("writes source-first catalogs and preserves existing translations", async () => {
    const fixtureDir = await copyFixture()

    await extract({
      config: path.join(fixtureDir, "palamedes.config.ts"),
    })

    const deCatalog = normalizePo(await readCatalog(fixtureDir, "de"))
    expect(findItem(deCatalog.items, "Simple hello")?.msgstr).toStrictEqual(["Einfach hallo"])
    expect(findItem(deCatalog.items, "Hello descriptor")).toBeDefined()
    expect(findItem(deCatalog.items, "Computed {last}")).toBeDefined()
    expect(findItem(deCatalog.items, "Context hello", "email.subject")).toBeDefined()
    expect(findItem(deCatalog.items, "{count, plural, one {# item} other {# items}}")).toBeDefined()
    expect(findItem(deCatalog.items, "Repeated origin")?.references).toStrictEqual([
      "src/App.tsx:15",
      "src/More.tsx:3",
    ])

    const enCatalog = normalizePo(await readCatalog(fixtureDir, "en"))
    expect(findItem(enCatalog.items, "Hello descriptor")?.msgstr).toStrictEqual([
      "Hello descriptor",
    ])
  })

  it("marks obsolete entries by default and removes them when clean is enabled", async () => {
    const fixtureDir = await copyFixture()

    await extract({
      config: path.join(fixtureDir, "palamedes.config.ts"),
    })

    expect(await readCatalog(fixtureDir, "en")).toContain('#~ msgid "Old only"')

    await extract({
      config: path.join(fixtureDir, "palamedes.config.ts"),
      clean: true,
    })

    const enCatalog = normalizePo(await readCatalog(fixtureDir, "en"))
    const deCatalog = normalizePo(await readCatalog(fixtureDir, "de"))
    expect(findItem(enCatalog.items, "Old only")).toBeUndefined()
    expect(findItem(deCatalog.items, "Old only")).toBeUndefined()
  })

  it("keeps repeated extract --clean output byte stable", async () => {
    const fixtureDir = await copyFixture()
    const options = {
      config: path.join(fixtureDir, "palamedes.config.ts"),
      clean: true,
    }

    await extract(options)
    const firstEnCatalog = await readCatalog(fixtureDir, "en")
    const firstDeCatalog = await readCatalog(fixtureDir, "de")

    await extract(options)
    expect(await readCatalog(fixtureDir, "en")).toBe(firstEnCatalog)
    expect(await readCatalog(fixtureDir, "de")).toBe(firstDeCatalog)
  })

  it("emits timing JSON with glob and extract buckets", async () => {
    const fixtureDir = await copyFixture()
    process.env.PALAMEDES_TIMING_JSON = "1"

    await extract({
      config: path.join(fixtureDir, "palamedes.config.ts"),
    })

    const timingCall = vi
      .mocked(console.log)
      .mock.calls.find(
        ([first]) => typeof first === "string" && first.startsWith("__PALAMEDES_TIMINGS__")
      )
    expect(timingCall).toBeDefined()

    const timing = JSON.parse(String(timingCall?.[0]).slice("__PALAMEDES_TIMINGS__".length))
    expect(timing).toMatchObject({
      engine: "ferrocat",
      totalMessages: 7,
      totalFiles: 2,
    })
    expect(timing.globMs).toStrictEqual(expect.any(Number))
    expect(timing.extractMs).toStrictEqual(expect.any(Number))
    expect(timing.writeMs).toStrictEqual(expect.any(Number))
    expect(timing.totalMs).toStrictEqual(expect.any(Number))
  })
})

async function copyFixture(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "palamedes-cli-"))
  const targetDir = path.join(dir, "fixture")
  tempDirs.push(dir)
  await cp(FIXTURE_DIR, targetDir, { recursive: true })
  return targetDir
}

async function readCatalog(fixtureDir: string, locale: string): Promise<string> {
  const catalogPath = path.join(fixtureDir, "src", "locales", `${locale}.po`)
  return readFile(catalogPath, "utf8")
}

function normalizePo(content: string) {
  const parsed = parsePo(content)
  const items = parsed.items.map((item) => ({
    msgid: item.msgid,
    msgctxt: item.msgctxt ?? null,
    msgstr: [...item.msgstr],
    references: [...item.references].sort(),
    obsolete: item.obsolete,
  }))

  return { items }
}

function findItem(items: ReturnType<typeof normalizePo>["items"], msgid: string, msgctxt?: string) {
  return items.find(
    (item) => item.msgid === msgid && (msgctxt === undefined || item.msgctxt === msgctxt)
  )
}
