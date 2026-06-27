import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
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

  it("emits relative PO references for parent-directory monorepo includes", async () => {
    const appDir = await createMonorepoFixture()

    await extract({
      config: path.join(appDir, "palamedes.config.ts"),
      clean: true,
    })

    const enCatalog = normalizePo(
      await readFile(path.join(appDir, "locales", "en", "messages.po"), "utf8")
    )
    expect(findItem(enCatalog.items, "Dashboard")?.references).toStrictEqual([
      "apps/web/app/page.tsx:3",
    ])
    expect(findItem(enCatalog.items, "Shared action")?.references).toStrictEqual([
      "packages/ui/src/shared-card.tsx:3",
    ])
  })

  it("supports Lingui-compatible config-root PO references", async () => {
    const appDir = await createMonorepoFixture({ sourceReferenceRoot: "lingui" })

    await extract({
      config: path.join(appDir, "palamedes.config.ts"),
      clean: true,
    })

    const enCatalog = normalizePo(
      await readFile(path.join(appDir, "locales", "en", "messages.po"), "utf8")
    )
    expect(findItem(enCatalog.items, "Dashboard")?.references).toStrictEqual(["app/page.tsx:3"])
    expect(findItem(enCatalog.items, "Shared action")?.references).toStrictEqual([
      "../../packages/ui/src/shared-card.tsx:3",
    ])
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

async function createMonorepoFixture(
  options: { sourceReferenceRoot?: "lingui" } = {}
): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "palamedes-cli-monorepo-"))
  tempDirs.push(dir)

  const repoDir = path.join(dir, "repo")
  const appDir = path.join(repoDir, "apps", "web")
  const sharedDir = path.join(repoDir, "packages", "ui", "src")
  await mkdir(path.join(repoDir, ".git"), { recursive: true })
  await mkdir(path.join(appDir, "app"), { recursive: true })
  await mkdir(sharedDir, { recursive: true })

  await writeFile(
    path.join(appDir, "palamedes.config.ts"),
    `import { defineConfig } from "@palamedes/config";

export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "de"],
  ${options.sourceReferenceRoot ? `sourceReferenceRoot: "${options.sourceReferenceRoot}",` : ""}
  catalogs: [
    {
      path: "locales/{locale}/messages",
      include: ["app", "../../packages/ui/src"],
    },
  ],
});
`,
    "utf8"
  )
  await writeFile(
    path.join(appDir, "app", "page.tsx"),
    `import { t } from "@palamedes/core/macro";
export function Page() {
  return t\`Dashboard\`;
}
`,
    "utf8"
  )
  await writeFile(
    path.join(sharedDir, "shared-card.tsx"),
    `import { t } from "@palamedes/core/macro";
export function SharedCard() {
  return t\`Shared action\`;
}
`,
    "utf8"
  )

  return appDir
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
