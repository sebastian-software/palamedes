import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  compileCatalogArtifact,
  compileCatalogModule,
  getNativeInfo,
  parsePo,
  transformMacrosNative,
} from "./index"

type SourceMapLike = {
  mappings?: string
  sources?: string[]
  sourcesContent?: Array<string | null>
  version?: number
}

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true })
    })
  )
})

describe("@palamedes/core-node", () => {
  it("loads native bindings and exposes version information", () => {
    const info = getNativeInfo()

    expect(info.palamedesVersion).toMatch(/^\d+\.\d+\.\d+/)
    expect(info.ferrocatVersion).toMatch(/^\d+\.\d+\.\d+/)
  })

  it("parses PO content across the NAPI boundary", () => {
    const parsed = parsePo(`msgid ""
msgstr ""
"Language: de\\n"

#, fuzzy
msgctxt "nav"
msgid "Open"
msgstr "Oeffnen"
`)

    expect(parsed.headers.Language).toBe("de")
    expect(parsed.items).toHaveLength(1)
    expect(parsed.items[0]).toMatchObject({
      msgctxt: "nav",
      msgid: "Open",
      msgstr: ["Oeffnen"],
      flags: { fuzzy: true },
    })
  })

  it("maps native transform results into JavaScript strings and source maps", () => {
    const source = `import { t } from "@palamedes/core/macro";
const msg = t\`Hello \${name}\`;
`
    const result = transformMacrosNative(source, "sample.ts")

    expect(result.hasChanged).toBe(true)
    expect(result.code).toContain('getI18n()._("')
    expect(result.compiledIds).toHaveLength(1)
    const map = normalizeSourceMap(result.map)
    expect(map).toMatchObject({
      version: 3,
      sources: ["sample.ts"],
      sourcesContent: [source],
    })
    expect(map.mappings).not.toBe("")
  })

  it("compiles catalog modules across the NAPI boundary", async () => {
    const rootDir = await createTempDir()
    const enCatalog = path.join(rootDir, "locales", "en")
    const deCatalog = path.join(rootDir, "locales", "de")

    await mkdir(enCatalog, { recursive: true })
    await mkdir(deCatalog, { recursive: true })
    await writeFile(
      path.join(enCatalog, "messages.po"),
      `msgid ""
msgstr ""
"Language: en\\n"

msgid "Hello"
msgstr "Hello"
`
    )
    await writeFile(
      path.join(deCatalog, "messages.po"),
      `msgid ""
msgstr ""
"Language: de\\n"

msgid "Hello"
msgstr "Hallo"
`
    )

    const result = compileCatalogModule(
      {
        rootDir,
        locales: ["en", "de"],
        sourceLocale: "en",
        catalogs: [{ path: "locales/{locale}/messages", include: ["src"] }],
      },
      path.join(deCatalog, "messages.po"),
      { locale: "de" }
    )

    expect(result.code).toContain("export const messages=")
    expect(result.code).toContain("Hallo")
    expect(result.warnings).toStrictEqual([])
    expect(result.watchFiles).toContain(path.join(deCatalog, "messages.po"))
  })

  it("renders catalog modules with the same message order as artifact objects", async () => {
    const rootDir = await createTempDir()
    const enCatalog = path.join(rootDir, "locales", "en")
    const deCatalog = path.join(rootDir, "locales", "de")

    await mkdir(enCatalog, { recursive: true })
    await mkdir(deCatalog, { recursive: true })
    await writeFile(
      path.join(enCatalog, "messages.po"),
      `msgid ""
msgstr ""
"Language: en\\n"

msgid "zeta"
msgstr "zeta"

msgid "alpha"
msgstr "alpha"
`
    )
    await writeFile(
      path.join(deCatalog, "messages.po"),
      `msgid ""
msgstr ""
"Language: de\\n"

msgid "zeta"
msgstr "Z"

msgid "alpha"
msgstr "A"
`
    )

    const config = {
      rootDir,
      locales: ["en", "de"],
      sourceLocale: "en",
      catalogs: [{ path: "locales/{locale}/messages", include: ["src"] }],
    }
    const resourcePath = path.join(deCatalog, "messages.po")
    const artifact = compileCatalogArtifact(config, resourcePath)
    const module = compileCatalogModule(config, resourcePath, { locale: "de" })

    expect(Object.keys(artifact.messages)).toStrictEqual(["alpha", "zeta"])
    expect(module.code).toBe(
      `export const messages=${JSON.stringify(artifact.messages)};export default { messages };`
    )
  })
})

function normalizeSourceMap(map: unknown): SourceMapLike {
  if (typeof map === "string") {
    return JSON.parse(map) as SourceMapLike
  }

  if (map === null || map === undefined) {
    throw new Error("Expected native transform to return a source map")
  }

  return map as SourceMapLike
}

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "palamedes-core-node-"))
  tempDirs.push(dir)
  return dir
}
