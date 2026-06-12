import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { mergeCatalog } from "./catalog"

vi.mock("@palamedes/core-node", async () => {
  const { readFileSync, writeFileSync } = await import("node:fs")

  function inferFormat(inputPaths: string[], outputPath: string): "po" | "json" {
    const formats = [...inputPaths, outputPath].map((filePath) => {
      if (filePath.endsWith(".po")) {
        return "po"
      }
      if (
        filePath.endsWith(".json") ||
        filePath.endsWith(".ndjson") ||
        filePath.endsWith(".fcat.ndjson")
      ) {
        return "json"
      }
      throw new Error("Could not infer catalog merge format")
    })
    if (!formats.every((format) => format === formats[0])) {
      throw new Error(
        "Catalog merge inputs and output must use the same format unless --format is provided."
      )
    }
    return formats[0]
  }

  function mergePo(first: string, second: string): string {
    const known = new Set([...first.matchAll(/msgid "([^"]*)"/g)].map((match) => match[1]))
    const additions = splitEntries(second).filter((entry) => {
      const id = entry.match(/msgid "([^"]*)"/)?.[1]
      return id && id !== "" && !known.has(id)
    })
    return `${first.trimEnd()}\n\n${additions.join("\n\n")}\n`
  }

  function mergeNdjson(first: string, second: string): string {
    const known = new Set([...first.matchAll(/"id":"([^"]*)"/g)].map((match) => match[1]))
    const additions = second
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .filter((line) => {
        const id = line.match(/"id":"([^"]*)"/)?.[1]
        return id && !known.has(id)
      })
    return `${first.trimEnd()}\n${additions.join("\n")}\n`
  }

  function splitEntries(content: string): string[] {
    return content
      .split(/\n\s*\n/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  }

  function countMessages(content: string, format: "po" | "json"): number {
    return format === "po"
      ? [...content.matchAll(/\n?msgid "([^"]+)"/g)].length
      : [...content.matchAll(/"id":"([^"]*)"/g)].length
  }

  return {
    mergeCatalogFiles(request: {
      inputPaths: string[]
      outputPath: string
      format?: "po" | "json"
    }) {
      const format = request.format ?? inferFormat(request.inputPaths, request.outputPath)
      const [firstPath, secondPath] = request.inputPaths
      const first = readFileSync(firstPath, "utf8")
      const second = readFileSync(secondPath, "utf8")
      const content = format === "po" ? mergePo(first, second) : mergeNdjson(first, second)
      writeFileSync(request.outputPath, content)
      return {
        outputPath: request.outputPath,
        format,
        stats: {
          inputs: 2,
          definitions: 0,
          selected: 0,
          skipped: 0,
          conflictsResolved: 0,
          total: countMessages(content, format),
        },
        diagnostics: [],
      }
    },
  }
})

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true })
    })
  )
})

describe("catalog merge", () => {
  it("merges PO catalogs with inferred format and git-driver-style output", async () => {
    const dir = await tempDir("po-inferred")
    const ours = path.join(dir, "messages.po")
    const theirs = path.join(dir, "theirs.po")
    await writeFile(
      ours,
      `msgid ""
msgstr ""
"Language: de\\n"

msgid "Hello"
msgstr "Hallo"
`
    )
    await writeFile(
      theirs,
      `msgid "Hello"
msgstr "Servus"

msgid "New"
msgstr "Neu"
`
    )

    const result = await mergeCatalog([ours, theirs], { output: ours })

    expect(result.format).toBe("po")
    expect(result.stats.total).toBe(2)
    const merged = await readFile(ours, "utf8")
    expect(merged).toContain('"Language: de\\n"')
    expect(merged).toContain('msgid "Hello"\nmsgstr "Hallo"')
    expect(merged).toContain('msgid "New"\nmsgstr "Neu"')
    expect(merged).not.toContain("Servus")
  })

  it("merges PO catalogs with explicit format", async () => {
    const dir = await tempDir("po-explicit")
    const ours = path.join(dir, "ours.catalog")
    const theirs = path.join(dir, "theirs.catalog")
    const output = path.join(dir, "merged.catalog")
    await writeFile(ours, 'msgid "Hello"\nmsgstr "Hallo"\n')
    await writeFile(theirs, 'msgid "New"\nmsgstr "Neu"\n')

    const result = await mergeCatalog([ours, theirs], {
      output,
      format: "po",
      sourceLocale: "en",
    })

    expect(result.format).toBe("po")
    const merged = await readFile(output, "utf8")
    expect(merged).toContain('msgid "Hello"')
    expect(merged).toContain('msgid "New"')
  })

  it("merges ferrocat ndjson catalogs through public json format", async () => {
    const dir = await tempDir("json")
    const ours = path.join(dir, "ours.json")
    const theirs = path.join(dir, "theirs.json")
    const output = path.join(dir, "merged.json")
    await writeFile(
      ours,
      `---
format: ferrocat.ndjson.v1
source_locale: en
locale: de
---
{"id":"Hello","str":"Hallo"}
`
    )
    await writeFile(
      theirs,
      `---
format: ferrocat.ndjson.v1
source_locale: en
locale: de
---
{"id":"Hello","str":"Servus"}
{"id":"New","str":"Neu","ctx":"nav"}
`
    )

    const result = await mergeCatalog([ours, theirs], {
      output,
      format: "json",
      sourceLocale: "en",
    })

    expect(result.format).toBe("json")
    const merged = await readFile(output, "utf8")
    expect(merged).toContain("format: ferrocat.ndjson.v1")
    expect(merged).toContain('"id":"Hello","str":"Hallo"')
    expect(merged).toContain('"id":"New","str":"Neu","ctx":"nav"')
    expect(merged).not.toContain("Servus")
  })

  it("fails mixed inferred formats without changing output", async () => {
    const dir = await tempDir("mixed")
    const ours = path.join(dir, "ours.po")
    const theirs = path.join(dir, "theirs.json")
    const output = path.join(dir, "merged.po")
    await writeFile(ours, 'msgid "Hello"\nmsgstr "Hallo"\n')
    await writeFile(theirs, '{"id":"Hello","str":"Hallo"}\n')
    await writeFile(output, "unchanged")

    await expect(mergeCatalog([ours, theirs], { output })).rejects.toThrow("same format")
    await expect(readFile(output, "utf8")).resolves.toBe("unchanged")
  })
})

async function tempDir(name: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), `palamedes-cli-merge-${name}-`))
  tempDirs.push(dir)
  return dir
}
