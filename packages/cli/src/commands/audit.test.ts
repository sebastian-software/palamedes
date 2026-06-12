import { cp, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { audit } from "./audit"

const FIXTURE_DIR = path.resolve(import.meta.dirname, "fixtures/ferrocat-first-test")

const tempDirs: string[] = []

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(async () => {
  vi.restoreAllMocks()

  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true })
    })
  )
})

describe("audit", () => {
  it("prints JSON and returns the native audit result", async () => {
    const fixtureDir = await copyFixture()
    await writeAuditCatalogs(fixtureDir)

    const result = await audit({
      config: path.join(fixtureDir, "palamedes.config.ts"),
      json: true,
    }).catch((error: unknown) => {
      expect(error).toBeInstanceOf(Error)
      return
    })

    expect(result).toBeUndefined()
    const output = vi.mocked(console.log).mock.calls[0]?.[0]
    const parsed = JSON.parse(String(output))
    expect(parsed.summary.errors).toBeGreaterThan(0)
    expect(
      parsed.diagnostics.some(
        (diagnostic: { code: string }) => diagnostic.code === "icu.missing_argument"
      )
    ).toBe(true)
  })

  it("passes when selected catalogs do not emit errors", async () => {
    const fixtureDir = await copyFixture()
    await writePassingAuditCatalogs(fixtureDir)

    const result = await audit({
      config: path.join(fixtureDir, "palamedes.config.ts"),
      locale: ["de"],
    })

    expect(result.summary.errors).toBe(0)
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("passed"))
  })
})

async function copyFixture(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "palamedes-cli-audit-"))
  const targetDir = path.join(dir, "fixture")
  tempDirs.push(dir)
  await cp(FIXTURE_DIR, targetDir, { recursive: true })
  return targetDir
}

async function writeAuditCatalogs(fixtureDir: string): Promise<void> {
  await writeFile(
    path.join(fixtureDir, "src/locales/en.po"),
    `msgid ""
msgstr ""
"Language: en\\n"

msgid "Hello {name}"
msgstr ""
`
  )
  await writeFile(
    path.join(fixtureDir, "src/locales/de.po"),
    `msgid ""
msgstr ""
"Language: de\\n"

msgid "Hello {name}"
msgstr "Hallo {firstName}"
`
  )
}

async function writePassingAuditCatalogs(fixtureDir: string): Promise<void> {
  await writeFile(
    path.join(fixtureDir, "src/locales/en.po"),
    `msgid ""
msgstr ""
"Language: en\\n"

msgid "Simple hello"
msgstr ""
`
  )
  await writeFile(
    path.join(fixtureDir, "src/locales/de.po"),
    `msgid ""
msgstr ""
"Language: de\\n"

msgid "Simple hello"
msgstr "Einfach hallo"
`
  )
}
