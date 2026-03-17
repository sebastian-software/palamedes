import { cp, mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { parsePo } from "@palamedes/core-node"

import { extract } from "./extract"

const FIXTURE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/ferrocat-first-test"
)

const tempDirs: string[] = []

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined)
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
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
    expect(findItem(deCatalog.items, "Simple hello")?.msgstr).toEqual(["Einfach hallo"])
    expect(findItem(deCatalog.items, "Hello descriptor")).toBeDefined()
    expect(findItem(deCatalog.items, "Context hello", "email.subject")).toBeDefined()
    expect(
      findItem(deCatalog.items, "{count, plural, one {# item} other {# items}}")
    ).toBeDefined()
    expect(findItem(deCatalog.items, "Repeated origin")?.references).toEqual([
      "src/App.tsx:14",
      "src/More.tsx:3",
    ])

    const enCatalog = normalizePo(await readCatalog(fixtureDir, "en"))
    expect(findItem(enCatalog.items, "Hello descriptor")?.msgstr).toEqual(["Hello descriptor"])
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

function findItem(
  items: ReturnType<typeof normalizePo>["items"],
  msgid: string,
  msgctxt?: string
) {
  return items.find((item) => item.msgid === msgid && (msgctxt === undefined || item.msgctxt === msgctxt))
}
