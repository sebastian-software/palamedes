import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { parsePo } from "@palamedes/core-node"

import { exportXliff, importXliff } from "./xliff"

const FIXTURE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/ferrocat-first-test"
)

const tempDirs: string[] = []

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined)
})

afterEach(async () => {
  vi.restoreAllMocks()

  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true })
    })
  )
})

describe("xliff", () => {
  it("exports configured PO catalogs as XLIFF 1.2", async () => {
    const fixtureDir = await copyFixture()
    const output = path.join(fixtureDir, "de.xlf")
    const deCatalog = path.join(fixtureDir, "src", "locales", "de.po")
    const existingCatalog = await readFile(deCatalog, "utf8")
    await writeFile(
      deCatalog,
      `${existingCatalog.trimEnd()}

msgctxt "email.subject"
msgid "Context hello"
msgstr "Betreff hallo"
`
    )

    const result = await exportXliff({
      config: path.join(fixtureDir, "palamedes.config.ts"),
      locale: "de",
      output,
    })

    expect(result.units).toBeGreaterThan(0)
    const xliff = await readFile(output, "utf8")
    expect(xliff).toContain('<xliff version="1.2"')
    expect(xliff).toContain('source-language="en"')
    expect(xliff).toContain('target-language="de"')
    expect(xliff).toContain("<source>Simple hello</source>")
    expect(xliff).toContain("<target state=\"translated\">Einfach hallo</target>")
    expect(xliff).toContain('resname="email.subject"')
    expect(xliff).toContain(
      '<note from="palamedes-context">email.subject</note>'
    )
  })

  it("imports translated XLIFF targets back into PO catalogs", async () => {
    const fixtureDir = await copyFixture()
    const output = path.join(fixtureDir, "de.xlf")
    const config = path.join(fixtureDir, "palamedes.config.ts")

    await exportXliff({ config, locale: "de", output })
    const xliff = (await readFile(output, "utf8")).replace(
      /<source>Simple hello<\/source>\n\s*<target state="translated">Einfach hallo<\/target>/,
      '<source>Simple hello</source>\n        <target state="needs-review-translation">Hallo Agentur</target>'
    )
    await writeFile(output, xliff)

    const result = await importXliff(output, { config })

    expect(result.updated).toBe(1)
    const item = findItem(await readCatalog(fixtureDir, "de"), "Simple hello")
    expect(item?.msgstr).toEqual(["Hallo Agentur"])
    expect(item?.flags.fuzzy).toBe(true)
  })

  it("imports self-closing XLIFF targets as empty translations", async () => {
    const fixtureDir = await copyFixture()
    const output = path.join(fixtureDir, "empty-target.xlf")
    const config = path.join(fixtureDir, "palamedes.config.ts")

    await writeFile(
      output,
      `<?xml version="1.0" encoding="UTF-8"?>
<xliff version="1.2">
  <file original="src/locales/de.po" source-language="en" target-language="de">
    <body>
      <trans-unit id="empty">
        <source>Simple hello</source>
        <target state="needs-translation"/>
      </trans-unit>
    </body>
  </file>
</xliff>
`
    )

    const result = await importXliff(output, { config })

    expect(result.updated).toBe(1)
    const item = findItem(await readCatalog(fixtureDir, "de"), "Simple hello")
    expect(item?.msgstr).toEqual([""])
  })

  it("rejects XLIFF original paths outside the configured root", async () => {
    const fixtureDir = await copyFixture()
    const output = path.join(fixtureDir, "traversal.xlf")
    const config = path.join(fixtureDir, "palamedes.config.ts")
    const poPath = path.join(fixtureDir, "src", "locales", "de.po")
    const before = await readFile(poPath, "utf8")

    await writeFile(
      output,
      `<?xml version="1.0" encoding="UTF-8"?>
<xliff version="1.2">
  <file original="../outside.po" source-language="en" target-language="de">
    <body>
      <trans-unit id="escape">
        <source>Simple hello</source>
        <target>Escaped</target>
      </trans-unit>
    </body>
  </file>
</xliff>
`
    )

    await expect(importXliff(output, { config })).rejects.toThrow(
      "escapes the configured rootDir"
    )
    await expect(readFile(poPath, "utf8")).resolves.toBe(before)
  })

  it("preserves plural msgstr indexes when importing XLIFF targets", async () => {
    const fixtureDir = await copyFixture()
    const output = path.join(fixtureDir, "plural.xlf")
    const config = path.join(fixtureDir, "palamedes.config.ts")
    const poPath = path.join(fixtureDir, "src", "locales", "de.po")
    const existingCatalog = await readFile(poPath, "utf8")

    await writeFile(
      poPath,
      `${existingCatalog.trimEnd()}

msgid "File"
msgid_plural "Files"
msgstr[0] "Datei"
msgstr[1] "Dateien"
`
    )
    await writeFile(
      output,
      `<?xml version="1.0" encoding="UTF-8"?>
<xliff version="1.2">
  <file original="src/locales/de.po" source-language="en" target-language="de">
    <body>
      <trans-unit id="plural">
        <source>File</source>
        <target>Akte</target>
      </trans-unit>
    </body>
  </file>
</xliff>
`
    )

    const result = await importXliff(output, { config })
    const updatedCatalog = await readFile(poPath, "utf8")

    expect(result.updated).toBe(1)
    expect(updatedCatalog).toContain('msgstr[0] "Akte"')
    expect(updatedCatalog).toContain('msgstr[1] "Dateien"')
    expect(updatedCatalog).not.toContain('msgid_plural "Files"\nmsgstr "Akte"')
  })

  it("fails conflicting duplicate XLIFF targets before writing PO output", async () => {
    const fixtureDir = await copyFixture()
    const output = path.join(fixtureDir, "conflict.xlf")
    const config = path.join(fixtureDir, "palamedes.config.ts")
    const poPath = path.join(fixtureDir, "src", "locales", "de.po")
    const before = await readFile(poPath, "utf8")

    await writeFile(
      output,
      `<?xml version="1.0" encoding="UTF-8"?>
<xliff version="1.2">
  <file original="src/locales/de.po" source-language="en" target-language="de">
    <body>
      <trans-unit id="one">
        <source>Simple hello</source>
        <target>Hallo eins</target>
      </trans-unit>
      <trans-unit id="two">
        <source>Simple hello</source>
        <target>Hallo zwei</target>
      </trans-unit>
    </body>
  </file>
</xliff>
`
    )

    await expect(importXliff(output, { config })).rejects.toThrow(
      "Conflicting XLIFF targets"
    )
    await expect(readFile(poPath, "utf8")).resolves.toBe(before)
  })
})

async function copyFixture(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "palamedes-cli-xliff-"))
  const targetDir = path.join(dir, "fixture")
  tempDirs.push(dir)
  await cp(FIXTURE_DIR, targetDir, { recursive: true })
  return targetDir
}

async function readCatalog(fixtureDir: string, locale: string) {
  const catalogPath = path.join(fixtureDir, "src", "locales", `${locale}.po`)
  const parsed = parsePo(await readFile(catalogPath, "utf8"))
  return parsed.items
}

function findItem(
  items: Awaited<ReturnType<typeof readCatalog>>,
  msgid: string,
  msgctxt?: string
) {
  return items.find(
    (item) =>
      item.msgid === msgid && (msgctxt === undefined || item.msgctxt === msgctxt)
  )
}
