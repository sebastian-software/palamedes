import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { report } from "./report"

vi.mock("@palamedes/core-node", () => ({
  parsePo: parseTestPo,
}))

const tempDirs: string[] = []

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined)
  vi.spyOn(console, "error").mockImplementation(() => undefined)
})

afterEach(async () => {
  vi.restoreAllMocks()

  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true })
    })
  )
})

describe("report", () => {
  it("prints JSON completeness by locale", async () => {
    const fixtureDir = await createReportFixture()

    const result = await report({
      config: path.join(fixtureDir, "palamedes.config.ts"),
      locale: ["de,fr"],
      json: true,
    })

    expect(result.locales[0]).toMatchObject({
      locale: "de",
      total: 3,
      translated: 1,
      missing: 1,
      fuzzy: 1,
    })
    expect(result.locales[0]?.percent).toBeCloseTo(100 / 3)
    expect(result.locales[1]).toEqual({
      locale: "fr",
      total: 3,
      translated: 0,
      missing: 3,
      fuzzy: 0,
      percent: 0,
    })

    const parsed = JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]))
    expect(parsed.locales[0].locale).toBe("de")
    expect(parsed.locales[1].missing).toBe(3)
  })

  it("prints a table for configured target locales and skips source and pseudo locales", async () => {
    const fixtureDir = await createReportFixture()

    await report({
      config: path.join(fixtureDir, "palamedes.config.ts"),
    })

    const output = vi.mocked(console.log).mock.calls.map((call) => String(call[0]))
    expect(output[0]).toBe("Locale  Translated  Missing  Fuzzy  Complete")
    expect(output.some((line) => line.startsWith("de"))).toBe(true)
    expect(output.some((line) => line.startsWith("fr"))).toBe(true)
    expect(output.some((line) => line.startsWith("en"))).toBe(false)
    expect(output.some((line) => line.startsWith("pseudo"))).toBe(false)
  })

  it("fails when a reported locale is below the threshold", async () => {
    const fixtureDir = await createReportFixture()

    await expect(
      report({
        config: path.join(fixtureDir, "palamedes.config.ts"),
        locale: ["de"],
        failIfBelow: "90",
      })
    ).rejects.toThrow("Catalog completeness below 90%")
  })
})

async function createReportFixture(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "palamedes-cli-report-"))
  tempDirs.push(dir)
  await mkdir(path.join(dir, "src/locales"), { recursive: true })

  await writeFile(
    path.join(dir, "palamedes.config.ts"),
    `export default {
  locales: ["en", "de", "fr", "pseudo"],
  sourceLocale: "en",
  pseudoLocale: "pseudo",
  catalogs: [
    {
      path: "src/locales/{locale}",
      include: ["src/**/*.{ts,tsx}"],
    },
  ],
}
`
  )
  await writeFile(
    path.join(dir, "src/locales/en.po"),
    `msgid ""
msgstr ""
"Language: en\\n"

msgid "Hello"
msgstr ""

msgctxt "nav"
msgid "Open"
msgstr ""

msgid "Bye"
msgstr ""
`
  )
  await writeFile(
    path.join(dir, "src/locales/de.po"),
    `msgid ""
msgstr ""
"Language: de\\n"

msgid "Hello"
msgstr "Hallo"

msgctxt "nav"
msgid "Open"
msgstr ""

#, fuzzy
msgid "Bye"
msgstr "Tschuess"
`
  )

  return dir
}

function parseTestPo(source: string) {
  return {
    comments: [],
    extractedComments: [],
    headers: {},
    headerOrder: [],
    items: source
      .split(/\n\s*\n/)
      .map((entry) => parseEntry(entry))
      .filter((item) => item !== undefined),
  }
}

function parseEntry(entry: string) {
  const msgid = entry.match(/^msgid "((?:[^"\\]|\\.)*)"/m)?.[1]
  if (msgid === undefined) {
    return undefined
  }

  const msgctxt = entry.match(/^msgctxt "((?:[^"\\]|\\.)*)"/m)?.[1]
  const msgstr = [...entry.matchAll(/^msgstr(?:\[\d+\])? "((?:[^"\\]|\\.)*)"/gm)].map(
    (match) => match[1] ?? ""
  )

  return {
    msgid,
    ...(msgctxt ? { msgctxt } : {}),
    references: [],
    msgstr,
    comments: [],
    extractedComments: [],
    flags: {
      fuzzy: entry.includes("#, fuzzy"),
    },
    metadata: {},
    obsolete: false,
    nplurals: msgstr.length,
  }
}
