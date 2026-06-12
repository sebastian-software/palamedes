import { describe, expect, it } from "vitest"

import { getNativeInfo, parsePo, transformMacrosNative } from "./index"

type SourceMapLike = {
  mappings?: string
  sources?: string[]
  sourcesContent?: Array<string | null>
  version?: number
}

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
