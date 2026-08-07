import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, describe, expect, it } from "vitest"

import {
  analyzeMdxNative,
  analyzeSourceNative,
  applyTranslationPatches,
  compileCatalogArtifact,
  compileCatalogModule,
  extractMessagesNative,
  getNativeInfo,
  listTranslationCandidates,
  mergeCatalogFilesThreeWay,
  mergeCatalogsThreeWay,
  parsePo,
  renderCatalogModule,
  transformMacrosNative,
  updateCatalogFile,
} from "./index"
import type {
  NativeBindings as GeneratedNativeBindings,
  TranslationPatchRequest as GeneratedTranslationPatchRequest,
  TranslationPatchResult as GeneratedTranslationPatchResult,
} from "./generated/palamedes-node-types"

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

  it("analyzes extracted messages and source diagnostics through one native contract", () => {
    const source = `import { t as translate } from "@palamedes/core/macro";
function Greeting({ name }: { name: string }) {
  return translate\`Hello \${name}\`;
}`
    const result = analyzeSourceNative(source, "greeting.tsx")

    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]?.message).toBe("Hello {name}")
    expect(result.diagnostics).toStrictEqual([])
  })

  it("maps MDX structural failures to the shared source diagnostic schema", () => {
    const result = analyzeSourceNative("# Good\n\n<Component\n", "broken.mdx")

    expect(result.messages).toStrictEqual([])
    expect(result.diagnostics[0]).toMatchObject({
      severity: "error",
      file: "broken.mdx",
      primary: { line: 3, column: 1 },
    })
  })

  it("configures source rule levels without changing extraction", () => {
    const source = `import { Trans } from "@palamedes/react/macro";
const message = <Trans><Button /></Trans>;`
    const defaultResult = analyzeSourceNative(source, "component.tsx")
    const configuredResult = analyzeSourceNative(source, "component.tsx", {
      rules: { emptyComponentOnly: "error" },
    })

    expect(defaultResult.diagnostics).toStrictEqual([])
    expect(configuredResult.diagnostics).toMatchObject([
      {
        code: "pmds/no-empty-component-only-message",
        severity: "error",
      },
    ])
  })

  it("suggests Trans for a directly rendered t message", () => {
    const source = `import { t as translate } from "@palamedes/solid/macro";
function Greeting({ name }) { return <p>{translate\`Hello \${name}\`}</p>; }`
    const result = analyzeSourceNative(source, "greeting.tsx")

    expect(result.diagnostics).toMatchObject([
      {
        code: "pmds/prefer-trans-in-jsx",
        severity: "info",
      },
    ])
    expect(result.diagnostics[0]?.message).toContain("`t` remains supported")
    expect(result.diagnostics[0]?.help).toContain("Solid's `<Trans>`")
  })

  it("renders executable catalog modules from in-memory messages", () => {
    const code = renderCatalogModule({
      greeting: "Hallo {name}",
      plain: "Willkommen",
    })

    expect(code).toContain(
      'import{defineCompiledCatalog as __palamedesDefineCompiledCatalog}from"@palamedes/core/compiled";'
    )
    expect(code).toContain('(v,r)=>r.join("Hallo ",r.value(v,"name"));')
    expect(code).toContain('["plain"]:"Willkommen"')
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

  it("maps generic PO output options across the NAPI boundary", async () => {
    const rootDir = await createTempDir()
    const targetPath = path.join(rootDir, "en.po")
    const long =
      "This deliberately long source message and translation value stays on one physical line when automatic PO folding is disabled."

    updateCatalogFile({
      targetPath,
      locale: "en",
      sourceLocale: "en",
      clean: false,
      po: { lineBreaks: "off" },
      messages: [
        { message: "Zebra", extractedComments: [], origins: [] },
        { message: long, extractedComments: [], origins: [] },
        { message: "Álgebra", extractedComments: [], origins: [] },
        { message: "éclair", extractedComments: [], origins: [] },
      ],
    })

    const output = await readFile(targetPath, "utf8")
    expect(output).toContain(`msgid "${long}"\nmsgstr "${long}"`)
    expect(parsePo(output).items.map((item) => item.msgid)).toStrictEqual([
      "Álgebra",
      "éclair",
      long,
      "Zebra",
    ])
  })

  it("performs deletion-aware three-way catalog merges across the NAPI boundary", async () => {
    const catalog = (entries: string) => `msgid ""
msgstr ""
"Language: de\\n"

${entries}`
    const ancestor = catalog(`msgid "Removed"
msgstr "Alt"
`)
    const ours = catalog(`msgid "New ours"
msgstr "Unser"
`)
    const theirs = catalog(`msgid "New theirs"
msgstr "Ihr"
`)
    const merged = mergeCatalogsThreeWay({
      ancestor: { content: ancestor, label: "base" },
      ours: { content: ours, label: "ours" },
      theirs: { content: theirs, label: "theirs" },
      format: "po",
      sourceLocale: "en",
      locale: "de",
    })

    expect(merged.content).not.toContain('msgid "Removed"')
    expect(merged.content).toContain('msgid "New ours"')
    expect(merged.content).toContain('msgid "New theirs"')

    const rootDir = await createTempDir()
    const ancestorPath = path.join(rootDir, "ancestor.po")
    const oursPath = path.join(rootDir, "ours.po")
    const theirsPath = path.join(rootDir, "theirs.po")
    const outputPath = path.join(rootDir, "merged.po")
    await Promise.all([
      writeFile(ancestorPath, ancestor),
      writeFile(oursPath, ours),
      writeFile(theirsPath, theirs),
    ])

    const fileResult = mergeCatalogFilesThreeWay({
      ancestorPath,
      oursPath,
      theirsPath,
      outputPath,
      sourceLocale: "en",
      locale: "de",
    })

    expect(fileResult.format).toBe("po")
    expect(await readFile(outputPath, "utf8")).toBe(merged.content)
  })

  it("enumerates and atomically applies typed translation patches", async () => {
    const rootDir = await createTempDir()
    const catalogDir = path.join(rootDir, "locales", "de")
    const targetPath = path.join(catalogDir, "messages.po")
    await mkdir(catalogDir, { recursive: true })
    await writeFile(
      targetPath,
      `msgid ""
msgstr ""
"Language: de\\n"

#. Home greeting
#: src/home.tsx#HomePage
msgid "Hello"
msgstr ""

msgid "{count, plural, one {# file} other {# files}}"
msgstr ""
`
    )
    const config = {
      rootDir,
      locales: ["en", "de"],
      sourceLocale: "en",
      catalogs: [{ path: "locales/{locale}/messages", include: ["src"] }],
    }
    const listed = listTranslationCandidates({ config })
    const hello = listed.candidates.find((candidate) => candidate.id.message === "Hello")
    const plural = listed.candidates.find((candidate) => candidate.source.kind === "plural")

    expect(listed.diagnostics).toStrictEqual([])
    expect(hello).toMatchObject({
      source: { kind: "singular", value: "Hello" },
      review: { translated: false, fuzzy: false, obsolete: false },
      origins: [{ file: "src/home.tsx", scope: "HomePage" }],
    })
    expect(plural?.source).toMatchObject({
      kind: "plural",
      variable: "count",
      values: { one: "# file", other: "# files" },
    })
    if (!hello || !plural || plural.source.kind !== "plural") {
      throw new Error("Expected singular and plural translation candidates")
    }

    const applied = applyTranslationPatches({
      config,
      patches: [
        {
          id: hello.id,
          fingerprint: hello.fingerprint,
          translation: { kind: "singular", value: "Hallo" },
        },
        {
          id: plural.id,
          fingerprint: plural.fingerprint,
          translation: {
            ...plural.source,
            values: { one: "# Datei", other: "# Dateien" },
          },
        },
      ],
    })

    expect(applied).toMatchObject({
      updated: true,
      stats: { requested: 2, applied: 2, catalogsUpdated: 1 },
      outcomes: [{ status: "applied" }, { status: "applied" }],
      diagnostics: [],
    })
    const output = await readFile(targetPath, "utf8")
    expect(output).toContain('msgstr "Hallo"')
    expect(output).toContain("{count, plural, one {# Datei} other {# Dateien}}")
  })

  it("exposes a partial report on a later native catalog write failure", async () => {
    const rootDir = await createTempDir()
    const firstPath = path.join(rootDir, "first", "de.po")
    const secondPath = path.join(rootDir, "second", "de.po")
    const config = {
      rootDir,
      locales: ["en", "de"],
      sourceLocale: "en",
      catalogs: [
        { path: "first/{locale}", include: ["src"] },
        { path: "second/{locale}", include: ["src"] },
      ],
    }
    const catalog = `msgid ""
msgstr ""
"Language: de\\n"

msgid "Hello"
msgstr ""
`
    await mkdir(path.dirname(firstPath), { recursive: true })
    await mkdir(path.dirname(secondPath), { recursive: true })
    await Promise.all([writeFile(firstPath, catalog), writeFile(secondPath, catalog)])

    const addon = await loadTestSupportAddon(rootDir)
    const listed = addon.listTranslationCandidates({ config, locales: ["de"], maxOrigins: 8 })
    const first = listed.candidates.find((candidate) => candidate.id.catalog === "first/{locale}")
    const second = listed.candidates.find((candidate) => candidate.id.catalog === "second/{locale}")
    if (!first || !second) {
      throw new Error("Expected candidates from both catalogs")
    }
    const request: GeneratedTranslationPatchRequest = {
      config,
      patches: [
        {
          id: first.id,
          fingerprint: first.fingerprint,
          translation: { kind: "Singular", value: "Hallo" },
        },
        {
          id: second.id,
          fingerprint: second.fingerprint,
          translation: { kind: "Singular", value: "Servus" },
        },
      ],
    }

    let thrown: unknown
    try {
      addon.applyTranslationPatchesWithInjectedWriteFailure(request, secondPath)
      throw new Error("Expected the injected replacement failure")
    } catch (error) {
      thrown = error
    }
    const error = thrown as Error & {
      code?: unknown
      cause?: Error & { code?: unknown }
      report?: GeneratedTranslationPatchResult
    }

    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe(
      "Failed to replace a translation catalog; completed per-file outcomes are available in error.report."
    )
    expect(error.code).toBe("ERR_PALAMEDES_TRANSLATION_PATCH_WRITE")
    expect(error.cause).toBeInstanceOf(Error)
    expect(error.cause?.code).toBe("ERR_PALAMEDES_CATALOG_WRITE")
    expect(error.cause?.message).toContain("injected catalog replacement failure")
    expect(error.report).toMatchObject({
      updated: true,
      stats: { requested: 2, applied: 1, catalogsUpdated: 1 },
      outcomes: [
        { id: first.id, status: "Applied" },
        { id: second.id, status: "NotApplied" },
      ],
      diagnostics: [],
    })
    await expect(readFile(firstPath, "utf8")).resolves.toContain('msgstr "Hallo"')
    await expect(readFile(secondPath, "utf8")).resolves.toBe(catalog)
  })

  it("patches candidates listed with truncated origins using a stable fingerprint", async () => {
    const rootDir = await createTempDir()
    const catalogDir = path.join(rootDir, "locales", "de")
    const targetPath = path.join(catalogDir, "messages.po")
    const canonicalOrigins = Array.from(
      { length: 10 },
      (_, index) => `#: src/origin-${index + 1}.tsx#Origin${index + 1}`
    ).join("\n")
    const origins = `${Array.from(
      { length: 10 },
      (_, index) => `#: src/origin-${10 - index}.tsx#Origin${10 - index}`
    ).join("\n")}\n#: src/origin-1.tsx#Origin1`
    await mkdir(catalogDir, { recursive: true })
    const catalog = `msgid ""
msgstr ""
"Language: de\\n"

${origins}
msgid "Hello"
msgstr ""
`
    await writeFile(targetPath, catalog)
    const config = {
      rootDir,
      locales: ["en", "de"],
      sourceLocale: "en",
      catalogs: [{ path: "locales/{locale}/messages", include: ["src"] }],
    }

    const twoOrigins = listTranslationCandidates({ config, maxOrigins: 2 })
    const sixOrigins = listTranslationCandidates({ config, maxOrigins: 6 })
    const limited = twoOrigins.candidates.find((candidate) => candidate.id.message === "Hello")
    const expanded = sixOrigins.candidates.find((candidate) => candidate.id.message === "Hello")

    expect(limited?.origins).toHaveLength(2)
    expect(expanded?.origins).toHaveLength(6)
    expect(limited?.fingerprint).toBe(expanded?.fingerprint)
    await writeFile(targetPath, catalog.replace(origins, canonicalOrigins))
    const rewritten = listTranslationCandidates({ config, maxOrigins: 2 }).candidates.find(
      (candidate) => candidate.id.message === "Hello"
    )
    expect(rewritten?.origins).toStrictEqual(limited?.origins)
    expect(rewritten?.fingerprint).toBe(limited?.fingerprint)
    if (!limited) {
      throw new Error("Expected candidate listed with truncated origins")
    }

    const applied = applyTranslationPatches({
      config,
      patches: [
        {
          id: limited.id,
          fingerprint: limited.fingerprint,
          translation: { kind: "singular", value: "Hallo" },
        },
      ],
    })

    expect(applied).toMatchObject({
      updated: true,
      stats: { requested: 1, applied: 1, catalogsUpdated: 1 },
      outcomes: [{ status: "applied" }],
      diagnostics: [],
    })
  })

  it("maps native transform results into JavaScript strings and source maps", () => {
    const source = `import { t } from "@palamedes/core/macro";
function message(name) {
  return t\`Hello \${name}\`;
}
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

  it.each(["react", "solid"] as const)(
    "analyzes and compiles MDX for the %s framework",
    (framework) => {
      const source = `---
title: Welcome
---

# Hello {name}

Read the **guide**.
`
      const result = analyzeMdxNative(source, "guide.mdx", {
        framework,
        frontMatterFields: ["title"],
      })

      expect(result.diagnostics).toStrictEqual([])
      expect(result.messages.map((message) => message.message)).toStrictEqual([
        "Welcome",
        "Hello {name}",
        "Read the <0>guide</0>.",
      ])
      expect(result.messages[1]?.origin).toMatchObject({
        0: "guide.mdx",
        1: 5,
      })
      expect(result.code).toContain(
        framework === "solid"
          ? 'from "@palamedes/solid/compiled"'
          : 'from "@palamedes/react/compiled"'
      )
      expect(result.compiledIds).toHaveLength(3)
      expect(normalizeSourceMap(result.map)).toMatchObject({
        version: 3,
        sources: ["guide.mdx"],
        sourcesContent: [source],
      })
    }
  )

  it("forwards MDX extraction options across the NAPI boundary", () => {
    expect(extractMessagesNative('<Card title="Open settings" />', "guide.mdx")).toStrictEqual([])
    expect(
      extractMessagesNative('<Card title="Open settings" />', "guide.mdx", {
        translatableAttributes: ["alt", "title"],
      })
    ).toMatchObject([{ message: "Open settings" }])
  })

  it("returns structured diagnostics for invalid MDX", () => {
    const result = analyzeMdxNative("# Good\n\n<Component\n", "broken.mdx")

    expect(result.code).toBeUndefined()
    expect(result.diagnostics[0]).toMatchObject({
      primary: { line: 3, column: 1 },
    })
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

msgid "Hello {name}"
msgstr "Hello {name}"

msgid "{count, plural, one {# message} other {# messages}}"
msgstr "{count, plural, one {# message} other {# messages}}"
`
    )
    await writeFile(
      path.join(deCatalog, "messages.po"),
      `msgid ""
msgstr ""
"Language: de\\n"

msgid "Hello"
msgstr "Hallo"

msgid "Hello {name}"
msgstr "Hallo {name}"

msgid "{count, plural, one {# message} other {# messages}}"
msgstr "{count, plural, one {# Nachricht} other {# Nachrichten}}"
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

    expect(result.code).toContain(
      'import{defineCompiledCatalog as __palamedesDefineCompiledCatalog}from"@palamedes/core/compiled";'
    )
    expect(result.code).toContain("export const messages=")
    expect(result.code).toContain("Hallo")
    expect(result.code).toContain('(v,r)=>r.join("Hallo ",r.value(v,"name"));')
    expect(result.code).toContain('r.plural(v,"count",0,"plural",')
    expect(result.code).toContain('r.join(r.pound(p)," Nachricht")')
    expect(result.warnings).toStrictEqual([])
    expect(result.watchFiles).toContain(path.join(deCatalog, "messages.po"))
    expect(result.locale).toBe("de")
  })

  it("resolves the module locale from the catalog path, not the caller-supplied locale", async () => {
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
msgstr ""
`
    )

    const config = {
      rootDir,
      locales: ["en", "de"],
      sourceLocale: "en",
      catalogs: [{ path: "locales/{locale}/messages", include: ["src"] }],
    }
    const resourcePath = path.join(deCatalog, "messages.po")

    /*
     * Loaders derive the caller locale from the file basename, which is
     * "messages" in the {locale}/messages.po layout. The resolved locale
     * must win for the result and for failure messages.
     */
    const result = compileCatalogModule(config, resourcePath, { locale: "messages" })
    expect(result.locale).toBe("de")

    expect(() =>
      compileCatalogModule(config, resourcePath, { locale: "messages", failOnMissing: true })
    ).toThrow(/locale de/)

    /*
     * A pseudo locale matching the resolved locale must bypass the
     * missing-translation gate even when the caller locale is wrong.
     */
    const pseudoConfig = { ...config, locales: ["en", "de"], pseudoLocale: "de" }
    expect(() =>
      compileCatalogModule(pseudoConfig, resourcePath, { locale: "messages", failOnMissing: true })
    ).not.toThrow()
  })

  it("renders catalog modules with the same message order as artifact objects", async () => {
    const rootDir = await createTempDir()
    const enCatalog = path.join(rootDir, "locales", "en")
    const deCatalog = path.join(rootDir, "locales", "de")
    const lineSeparators = `Line${String.fromCharCode(8232)}Paragraph${String.fromCharCode(
      8233
    )}End`

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

msgid "line-separators"
msgstr "line-separators"
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

msgid "line-separators"
msgstr "${lineSeparators}"
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
    const messageIds = Object.keys(artifact.messages)

    expect(messageIds).toStrictEqual([...messageIds].sort())
    expect(JSON.stringify(artifact.messages)).toContain(lineSeparators)
    const entries = Object.entries(artifact.messages)
      .map(([id, message]) => `[${JSON.stringify(id)}]:${JSON.stringify(message)}`)
      .join(",")
    expect(module.code).toBe(
      `import{defineCompiledCatalog as __palamedesDefineCompiledCatalog}from"@palamedes/core/compiled";export const messages=__palamedesDefineCompiledCatalog({${entries}});export default { messages };`
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

type TestSupportBindings = Pick<GeneratedNativeBindings, "listTranslationCandidates"> & {
  applyTranslationPatchesWithInjectedWriteFailure(
    request: GeneratedTranslationPatchRequest,
    failingPath: string
  ): GeneratedTranslationPatchResult
}

async function loadTestSupportAddon(tempDir: string): Promise<TestSupportBindings> {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
  execFileSync("cargo", ["build", "--package", "palamedes-node", "--features", "test-support"], {
    cwd: repoRoot,
    stdio: "inherit",
  })
  const extension =
    process.platform === "win32" ? "dll" : process.platform === "darwin" ? "dylib" : "so"
  const libraryName = `${process.platform === "win32" ? "" : "lib"}palamedes_node.${extension}`
  const addonPath = path.join(tempDir, "palamedes-node.node")
  await copyFile(path.join(repoRoot, "target", "debug", libraryName), addonPath)
  if (process.platform === "darwin") {
    execFileSync("codesign", ["--force", "--sign", "-", "--timestamp=none", addonPath], {
      stdio: "inherit",
    })
  }
  return createRequire(import.meta.url)(addonPath) as TestSupportBindings
}
