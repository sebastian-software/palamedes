import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { createRequire } from "node:module"
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { runInNewContext } from "node:vm"
import { promisify } from "node:util"

import { afterEach, describe, expect, it } from "vitest"

import {
  analyzeMdxNative,
  analyzeSourceNative,
  applyTranslationPatches,
  applyTranslationPatchesAsync,
  compileCatalogArtifact,
  compileCatalogArtifactAsync,
  compileCatalogArtifactSelected,
  compileCatalogArtifactSelectedAsync,
  compileCatalogModule,
  compileCatalogModuleAsync,
  extractCatalogMessagesFromFiles,
  extractCatalogMessagesFromFilesAsync,
  extractMessagesNative,
  getNativeInfo,
  listTranslationCandidates,
  mergeCatalogFilesThreeWay,
  mergeCatalogsThreeWay,
  parsePo,
  renderCatalogModule,
  transformMacrosNative,
  updateCatalogFile,
  updateCatalogFileAsync,
} from "./index"
import type {
  NativeBindings as GeneratedNativeBindings,
  TranslationPatchRequest as GeneratedTranslationPatchRequest,
  TranslationPatchResult as GeneratedTranslationPatchResult,
} from "./generated/palamedes-node-types"
import {
  assertNativeBindingVersion,
  assertWellFormedNativeArguments,
  loadNativeBindings,
  resolveNativePackageName,
  snapshotNativeArguments,
} from "./native-loader"

type SourceMapLike = {
  mappings?: string
  sources?: string[]
  sourcesContent?: Array<string | null>
  version?: number
}

const tempDirs: string[] = []
let testSupportAddon: TestSupportBindings | undefined
const execFileAsync = promisify(execFile)

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true })
    })
  )
})

describe("@palamedes/core-node", () => {
  it("resolves every published native platform package", () => {
    const targets = [
      [{ platform: "darwin", arch: "arm64" }, "@palamedes/core-node-darwin-arm64"],
      [{ platform: "darwin", arch: "x64" }, "@palamedes/core-node-darwin-x64"],
      [{ platform: "linux", arch: "x64", linuxLibc: "gnu" }, "@palamedes/core-node-linux-x64-gnu"],
      [
        { platform: "linux", arch: "x64", linuxLibc: "musl" },
        "@palamedes/core-node-linux-x64-musl",
      ],
      [
        { platform: "linux", arch: "arm64", linuxLibc: "gnu" },
        "@palamedes/core-node-linux-arm64-gnu",
      ],
      [
        { platform: "linux", arch: "arm64", linuxLibc: "musl" },
        "@palamedes/core-node-linux-arm64-musl",
      ],
      [{ platform: "win32", arch: "x64" }, "@palamedes/core-node-win32-x64-msvc"],
      [{ platform: "win32", arch: "arm64" }, "@palamedes/core-node-win32-arm64-msvc"],
    ] as const

    for (const [target, expectedPackage] of targets) {
      expect(resolveNativePackageName(target)).toBe(expectedPackage)
    }
  })

  it("rejects a mismatched platform binding before exposing the native surface", () => {
    expect(() =>
      assertNativeBindingVersion("1.14.0", "@palamedes/core-node-linux-x64-gnu", {
        palamedesVersion: "1.15.0",
        ferrocatVersion: "0.1.0",
      })
    ).toThrow(
      "@palamedes/core-node@1.14.0 loaded @palamedes/core-node-linux-x64-gnu with native version 1.15.0"
    )
    expect(() =>
      assertNativeBindingVersion("1.14.0", "@palamedes/core-node-linux-x64-gnu", {
        palamedesVersion: "1.14.0",
        ferrocatVersion: "0.1.0",
      })
    ).not.toThrow()

    const fixtureBindings = {
      getNativeInfo: () => ({ palamedesVersion: "1.15.0", ferrocatVersion: "0.1.0" }),
    }
    expect(() =>
      loadNativeBindings({
        packageDir: "/fixture/core-node",
        nativePackageName: "@palamedes/core-node-win32-x64-msvc",
        require(specifier) {
          return specifier.endsWith("package.json") ? { version: "1.14.0" } : fixtureBindings
        },
      })
    ).toThrow("@palamedes/core-node-win32-x64-msvc with native version 1.15.0")
  })

  it("rejects lone surrogates without changing well-formed nested request data", () => {
    const validRequest = {
      config: {
        rootDir: "café",
        locales: ["en", "de", "emoji-😀"],
        sourceLocale: "en",
        fallbackLocales: { de: ["en"] },
        catalogs: [{ path: "locales/{locale}", include: ["src/e\u0301.ts"] }],
      },
      compiledIds: ["hello"],
    }
    const before = structuredClone(validRequest)

    expect(() =>
      assertWellFormedNativeArguments("compileCatalogArtifactSelected", [validRequest])
    ).not.toThrow()
    expect(validRequest).toStrictEqual(before)
    expect(() => parsePo("\ud800")).toThrow(/parsePo\.argument\[0\]/u)
    expect(() =>
      assertWellFormedNativeArguments("compileCatalogModule", [
        { config: { locales: ["en", "\udc00"] } },
      ])
    ).toThrow(/compileCatalogModule\.argument\[0\]\.config\.locales\[1\]/u)
    expect(() =>
      assertWellFormedNativeArguments("renderCatalogModule", [{ message: ["valid", "\ud800"] }])
    ).toThrow(/renderCatalogModule\.argument\[0\]\.message\[1\]/u)

    const isWellFormed = Reflect.getOwnPropertyDescriptor(String.prototype, "isWellFormed")
    Reflect.deleteProperty(String.prototype, "isWellFormed")
    try {
      expect(() => parsePo("\ud800")).toThrow(/parsePo\.argument\[0\]/u)
    } finally {
      if (isWellFormed) Reflect.defineProperty(String.prototype, "isWellFormed", isWellFormed)
    }
  })

  it("passes the single validated accessor and Proxy snapshot to native bindings", () => {
    let accessorReads = 0
    const accessorMessages: Record<string, string> = {}
    Object.defineProperty(accessorMessages, "message", {
      enumerable: true,
      get() {
        accessorReads += 1
        return accessorReads === 1 ? "from accessor" : "\ud800"
      },
    })

    const accessorRendered = renderCatalogModule(accessorMessages)
    expect(accessorReads).toBe(1)
    expect(accessorRendered).toContain("from accessor")
    expect(accessorRendered).not.toContain("�")

    let proxyReads = 0
    const proxyMessages = new Proxy(
      { message: "unused" },
      {
        get(target, property, receiver) {
          if (property === "message") {
            proxyReads += 1
            return proxyReads === 1 ? "from proxy" : "\udc00"
          }
          return Reflect.get(target, property, receiver)
        },
      }
    )
    const proxyRendered = renderCatalogModule(proxyMessages)
    expect(proxyReads).toBe(1)
    expect(proxyRendered).toContain("from proxy")
    expect(proxyRendered).not.toContain("�")
  })

  it("snapshots nested accessors, arrays, and getter failures deterministically", () => {
    let nestedReads = 0
    const nested: { config: { locales: string[] } } = { config: {} as { locales: string[] } }
    Object.defineProperty(nested.config, "locales", {
      enumerable: true,
      get() {
        nestedReads += 1
        return nestedReads === 1 ? ["en", "cafe\u0301", "😀"] : ["\ud800"]
      },
    })
    const request = { request: nested }
    const snapshot = snapshotNativeArguments("compileCatalogModule", [request])
    const snapshotRequest = snapshot[0] as { request: { config: { locales: string[] } } }

    expect(nestedReads).toBe(1)
    expect(snapshotRequest).not.toBe(request)
    expect(snapshotRequest.request).toStrictEqual({
      config: { locales: ["en", "cafe\u0301", "😀"] },
    })
    expect(nested.config.locales).toStrictEqual(["\ud800"])

    const cyclic: { message: string; self?: unknown } = { message: "cycle" }
    cyclic.self = cyclic
    const cyclicSnapshot = snapshotNativeArguments("renderCatalogModule", [cyclic])[0] as {
      self: unknown
    }
    expect(cyclicSnapshot.self).toBe(cyclicSnapshot)

    const failure = new Error("fixture getter failure")
    const throwingRequest = {}
    Object.defineProperty(throwingRequest, "locale", {
      enumerable: true,
      get() {
        throw failure
      },
    })
    try {
      snapshotNativeArguments("compileCatalogModule", [throwingRequest])
      throw new Error("Expected a throwing getter to fail the native boundary snapshot.")
    } catch (error) {
      expect(error).toMatchObject({ cause: failure })
      expect(error).toHaveProperty(
        "message",
        expect.stringMatching(/could not read compileCatalogModule\.argument\[0\]\.locale/u)
      )
    }
  })

  it("preserves native-visible class and enumerable record semantics", () => {
    class ClassBackedMessages implements Record<string, string> {
      [key: string]: string

      public message = "from class"
    }
    expect(renderCatalogModule(new ClassBackedMessages())).toContain("from class")

    class PrototypeGetterMessages implements Record<string, string> {
      [key: string]: string

      public get message() {
        return ["from prototype getter"].join("")
      }
    }
    expect(renderCatalogModule(new PrototypeGetterMessages())).toContain("from prototype getter")

    // A prototype method is a data property holding a function. Snapshotting it
    // would push a function across the boundary, so it must stay out — the
    // getter above is the only prototype member the binding sees. The declared
    // parameter type rules such a class out, so the cast stands in for the
    // untyped JavaScript caller the boundary has to survive.
    class MethodBackedMessages {
      public message = "from class with a method"

      public format() {
        return "helper"
      }

      public toString() {
        return "helper"
      }
    }
    const methodBacked = renderCatalogModule(
      new MethodBackedMessages() as unknown as Record<string, string>
    )
    expect(methodBacked).toContain("from class with a method")
    expect(methodBacked).not.toContain("format")

    const nonEnumerableMessages: Record<string, string> = {}
    Object.defineProperty(nonEnumerableMessages, "hidden", {
      configurable: true,
      value: "not native-visible",
      writable: true,
    })
    expect(renderCatalogModule(nonEnumerableMessages)).not.toContain("not native-visible")

    // The same exclusion applies to a class instance, so the two record shapes
    // cannot disagree about which own properties are native-visible.
    const nonEnumerableInstance = new ClassBackedMessages()
    Object.defineProperty(nonEnumerableInstance, "hidden", {
      configurable: true,
      value: "not native-visible",
      writable: true,
    })
    expect(renderCatalogModule(nonEnumerableInstance)).not.toContain("not native-visible")
  })

  it("rejects a Map instead of silently rendering an empty catalog", () => {
    expect(() => renderCatalogModule(new Map([["greeting", "hi"]]) as never)).toThrow(
      /rejected a Map in renderCatalogModule\.argument\[0\]/u
    )

    class MessageMap extends Map<string, string> {}
    expect(() => renderCatalogModule(new MessageMap([["greeting", "hi"]]) as never)).toThrow(
      /rejected a Map in renderCatalogModule\.argument\[0\]/u
    )

    expect(renderCatalogModule(Object.fromEntries(new Map([["greeting", "hi"]])))).toContain("hi")
  })

  it("classifies Proxy metadata once and translates prototype and length errors", () => {
    let prototypeReads = 0
    const stablePrototypeProxy = new Proxy(
      { message: "one prototype read" },
      {
        getPrototypeOf(target) {
          prototypeReads += 1
          return Reflect.getPrototypeOf(target)
        },
      }
    )
    expect(renderCatalogModule(stablePrototypeProxy)).toContain("one prototype read")
    expect(prototypeReads).toBe(1)

    const prototypeFailure = new Error("fixture prototype failure")
    const throwingPrototypeProxy = new Proxy(
      { message: "unreachable" },
      {
        getPrototypeOf() {
          throw prototypeFailure
        },
      }
    )
    try {
      renderCatalogModule(throwingPrototypeProxy)
      throw new Error(
        "Expected a throwing getPrototypeOf trap to fail the native boundary snapshot."
      )
    } catch (error) {
      expect(error).toMatchObject({ cause: prototypeFailure })
      expect(error).toHaveProperty(
        "message",
        expect.stringMatching(/could not read renderCatalogModule\.argument\[0\]/u)
      )
    }

    const lengthFailure = new Error("fixture length failure")
    const throwingLengthProxy = new Proxy(["message"], {
      get(target, property, receiver) {
        if (property === "length") throw lengthFailure
        return Reflect.get(target, property, receiver)
      },
    })
    try {
      compileCatalogArtifactSelected(
        { rootDir: ".", locales: ["en"], sourceLocale: "en", catalogs: [] },
        "fixture.po",
        throwingLengthProxy
      )
      throw new Error("Expected a throwing length trap to fail the native boundary snapshot.")
    } catch (error) {
      expect(error).toMatchObject({ cause: lengthFailure })
      expect(error).toHaveProperty(
        "message",
        expect.stringMatching(
          /could not read compileCatalogArtifactSelected\.argument\[0\]\.compiledIds/u
        )
      )
    }
  })

  it("uses the content-addressed test-support addon prepared before tests", async () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
    const addonPath = await testSupportAddonPath(repoRoot)

    expect(await testSupportAddonPath(repoRoot)).toBe(addonPath)
    expect(path.basename(addonPath)).toMatch(/^palamedes-node-test-support-[a-f0-9]{16}\.node$/u)
    await expect(access(addonPath)).resolves.toBeUndefined()
  })

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

  it("keeps sync and async catalog, extraction, update, and patch results equivalent", async () => {
    const rootDir = await createTempDir()
    const syncRoot = path.join(rootDir, "sync")
    const asyncRoot = path.join(rootDir, "async")
    const catalog = `msgid ""
msgstr ""
"Language: de\\n"

msgid "Hello"
msgstr "Hallo"
`
    const source = `import { t } from "@palamedes/core/macro"
export function greeting() {
  return t({ message: "Hello" })
}
`

    for (const fixtureRoot of [syncRoot, asyncRoot]) {
      await mkdir(path.join(fixtureRoot, "locales", "en"), { recursive: true })
      await mkdir(path.join(fixtureRoot, "locales", "de"), { recursive: true })
      await mkdir(path.join(fixtureRoot, "src"), { recursive: true })
      await writeFile(
        path.join(fixtureRoot, "locales", "en", "messages.po"),
        catalog.replace("Language: de", "Language: en").replace('msgstr "Hallo"', 'msgstr "Hello"')
      )
      await writeFile(path.join(fixtureRoot, "locales", "de", "messages.po"), catalog)
      await writeFile(path.join(fixtureRoot, "src", "message.ts"), source)
    }

    const configFor = (fixtureRoot: string) => ({
      rootDir: fixtureRoot,
      locales: ["en", "de"],
      sourceLocale: "en",
      catalogs: [{ path: "locales/{locale}/messages", include: ["src"] }],
    })
    const syncConfig = configFor(syncRoot)
    const asyncConfig = configFor(asyncRoot)
    const syncCatalogPath = path.join(syncRoot, "locales", "de", "messages.po")
    const asyncCatalogPath = path.join(asyncRoot, "locales", "de", "messages.po")

    const syncArtifact = compileCatalogArtifact(syncConfig, syncCatalogPath)
    expect(await compileCatalogArtifactAsync(syncConfig, syncCatalogPath)).toStrictEqual(
      syncArtifact
    )
    const compiledId = Object.keys(syncArtifact.messages)[0]
    if (!compiledId) {
      throw new Error("Expected a compiled message ID for async parity")
    }
    expect(
      await compileCatalogArtifactSelectedAsync(syncConfig, syncCatalogPath, [compiledId])
    ).toStrictEqual(compileCatalogArtifactSelected(syncConfig, syncCatalogPath, [compiledId]))
    expect(
      await compileCatalogModuleAsync(syncConfig, syncCatalogPath, { locale: "de" })
    ).toStrictEqual(compileCatalogModule(syncConfig, syncCatalogPath, { locale: "de" }))

    const syncSourcePath = path.join(syncRoot, "src", "message.ts")
    const extractRequest = {
      rootDir: syncRoot,
      files: [syncSourcePath],
      maxThreads: 1,
    }
    const syncExtract = extractCatalogMessagesFromFiles(extractRequest)
    const asyncExtract = await extractCatalogMessagesFromFilesAsync(extractRequest)
    expect(asyncExtract).toStrictEqual(syncExtract)

    const updateMessages = [
      { message: "Hello", extractedComments: [], origins: [] },
      { message: "New", extractedComments: [], origins: [] },
    ]
    const syncUpdate = updateCatalogFile({
      targetPath: syncCatalogPath,
      locale: "de",
      sourceLocale: "en",
      clean: false,
      messages: updateMessages,
    })
    const asyncUpdate = await updateCatalogFileAsync({
      targetPath: asyncCatalogPath,
      locale: "de",
      sourceLocale: "en",
      clean: false,
      messages: updateMessages,
    })
    expect(asyncUpdate).toStrictEqual(syncUpdate)
    expect(await readFile(asyncCatalogPath, "utf8")).toBe(await readFile(syncCatalogPath, "utf8"))

    const syncCandidate = listTranslationCandidates({ config: syncConfig }).candidates.find(
      (candidate) => candidate.id.message === "New"
    )
    const asyncCandidate = listTranslationCandidates({ config: asyncConfig }).candidates.find(
      (candidate) => candidate.id.message === "New"
    )
    if (!syncCandidate || !asyncCandidate) {
      throw new Error("Expected matching translation candidates for async parity")
    }
    const syncPatch = applyTranslationPatches({
      config: syncConfig,
      patches: [
        {
          id: syncCandidate.id,
          fingerprint: syncCandidate.fingerprint,
          translation: { kind: "singular", value: "Neu" },
        },
      ],
    })
    const asyncPatch = await applyTranslationPatchesAsync({
      config: asyncConfig,
      patches: [
        {
          id: asyncCandidate.id,
          fingerprint: asyncCandidate.fingerprint,
          translation: { kind: "singular", value: "Neu" },
        },
      ],
    })
    expect(asyncPatch).toStrictEqual(syncPatch)
    expect(await readFile(asyncCatalogPath, "utf8")).toBe(await readFile(syncCatalogPath, "utf8"))
  })

  it("keeps async errors equivalent to sync errors", async () => {
    const rootDir = await createTempDir()
    const config = {
      rootDir,
      locales: ["en", "de"],
      sourceLocale: "en",
      catalogs: [{ path: "locales/{locale}/messages", include: ["src"] }],
    }
    const missingPath = path.join(rootDir, "locales", "de", "messages.po")
    let syncError: unknown
    try {
      compileCatalogArtifact(config, missingPath)
    } catch (error) {
      syncError = error
    }

    await expect(compileCatalogArtifactAsync(config, missingPath)).rejects.toMatchObject({
      message: (syncError as Error).message,
    })
  })

  it("keeps the event loop responsive while catalog compilation runs off-thread", async () => {
    const rootDir = await createTempDir()
    const sourceCatalogDir = path.join(rootDir, "locales", "en")
    const catalogDir = path.join(rootDir, "locales", "de")
    await mkdir(sourceCatalogDir, { recursive: true })
    await mkdir(catalogDir, { recursive: true })
    await writeFile(
      path.join(sourceCatalogDir, "messages.po"),
      `msgid ""
msgstr ""
"Language: en\\n"

msgid "Hello"
msgstr "Hello"
`
    )
    await writeFile(
      path.join(catalogDir, "messages.po"),
      `msgid ""
msgstr ""
"Language: de\\n"

msgid "Hello"
msgstr "Hallo"
`
    )
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
    const addonPath = await testSupportAddonPath(repoRoot)
    const childPath = path.join(repoRoot, "packages/core-node/scripts/async-event-loop-child.mjs")

    await expect(
      execFileAsync(process.execPath, [childPath, addonPath, rootDir], { timeout: 10_000 })
    ).resolves.toMatchObject({ stderr: "" })
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

  it("serializes skipped fresh target catalogs while excluding an explicit source locale", async () => {
    const rootDir = await createTempDir()
    const targetPath = path.join(rootDir, "locales", "de", "messages.po")
    await mkdir(path.dirname(targetPath), { recursive: true })
    await writeFile(
      targetPath,
      `msgid ""
msgstr ""
"Language: de\\n"

msgid "Hello"
msgstr ""
`
    )
    const config = {
      rootDir,
      locales: ["en", "de", "fr"],
      sourceLocale: "en",
      catalogs: [{ path: "locales/{locale}/messages", include: ["src"] }],
    }
    const missingCatalogPath = `${rootDir}${path.sep}locales/fr/messages.po`

    const defaultResult = listTranslationCandidates({ config })
    expect(defaultResult.candidates).toHaveLength(1)
    expect(
      defaultResult.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        catalogPath: diagnostic.catalogPath?.replaceAll("\\", "/"),
      }))
    ).toStrictEqual([
      {
        code: "translation.missing_catalog",
        message:
          `Translation catalog for locale \`fr\` is missing at \`${rootDir}${path.sep}locales/fr/messages.po\`. ` +
          "Run `pmds extract` to create it before requesting this locale explicitly.",
        locale: "fr",
        catalogPath: path.join(rootDir, "locales", "fr", "messages.po").replaceAll("\\", "/"),
      },
    ])

    const sourceResult = listTranslationCandidates({ config, locales: ["en"] })
    expect(sourceResult).toStrictEqual({ candidates: [], diagnostics: [] })
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

    const addon = await loadTestSupportAddon()
    expect(await loadTestSupportAddon()).toBe(addon)
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

    await Promise.all([writeFile(firstPath, catalog), writeFile(secondPath, catalog)])
    await expect(
      addon.applyTranslationPatchesWithInjectedWriteFailureAsync(request, secondPath)
    ).rejects.toMatchObject({
      code: "ERR_PALAMEDES_TRANSLATION_PATCH_WRITE",
      cause: expect.objectContaining({ code: "ERR_PALAMEDES_CATALOG_WRITE" }),
      report: expect.objectContaining({
        updated: true,
        stats: expect.objectContaining({ requested: 2, applied: 1, catalogsUpdated: 1 }),
        outcomes: [
          expect.objectContaining({ id: first.id, status: "Applied" }),
          expect.objectContaining({ id: second.id, status: "NotApplied" }),
        ],
      }),
    })
  })

  it("surfaces a native panic as a catchable JavaScript error", async () => {
    const addon = await loadTestSupportAddon()

    expect(() => addon.panicForTestSupport()).toThrowError(/Palamedes test-support panic/u)
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

  it("executes transformed Trans through the compiled import when an authored local shadows it", () => {
    const source = `import { Trans as MacroTrans } from "@palamedes/react/macro";
import { Trans } from "@palamedes/react/compiled";
function Example() {
  const Trans = () => "authored-shadow"
  return <MacroTrans>Hello</MacroTrans>
}`
    const result = transformMacrosNative(source, "sample.tsx")

    expect(result.code).toContain(
      'import { Trans as __palamedesTrans } from "@palamedes/react/compiled";'
    )
    expect(result.code).toContain("return <__palamedesTrans id=")

    const executable = result.code
      .replace(
        'import { Trans as __palamedesTrans } from "@palamedes/react/compiled";',
        'const __palamedesTrans = () => "compiled-component";'
      )
      .replace(
        'import { Trans } from "@palamedes/react/compiled";',
        'const Trans = () => "top-level-import";'
      )
      .replace(/return <__palamedesTrans id="[^"]+" \/>/u, "return __palamedesTrans()")
    const context: {
      Example?: () => string
    } = {}

    runInNewContext(executable, context)

    expect(context.Example?.()).toBe("compiled-component")
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
  compileCatalogArtifactWithDelayForTestSupport(
    request: Parameters<GeneratedNativeBindings["compileCatalogArtifact"]>[0],
    delayMs: number
  ): Promise<Awaited<ReturnType<GeneratedNativeBindings["compileCatalogArtifactAsync"]>>>
  applyTranslationPatchesWithInjectedWriteFailure(
    request: GeneratedTranslationPatchRequest,
    failingPath: string
  ): GeneratedTranslationPatchResult
  applyTranslationPatchesWithInjectedWriteFailureAsync(
    request: GeneratedTranslationPatchRequest,
    failingPath: string
  ): Promise<GeneratedTranslationPatchResult>
  panicForTestSupport(): void
}

async function loadTestSupportAddon(): Promise<TestSupportBindings> {
  if (testSupportAddon) {
    return testSupportAddon
  }
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
  const addonPath = await testSupportAddonPath(repoRoot)
  const require = createRequire(import.meta.url)
  const cached = require.cache[addonPath]
  testSupportAddon = (cached?.exports ?? require(addonPath)) as TestSupportBindings
  return testSupportAddon
}

async function testSupportAddonPath(repoRoot: string): Promise<string> {
  const extension =
    process.platform === "win32" ? "dll" : process.platform === "darwin" ? "dylib" : "so"
  const libraryName = `${process.platform === "win32" ? "" : "lib"}palamedes_node.${extension}`
  const library = await readFile(path.join(repoRoot, "target", "debug", libraryName))
  const digest = createHash("sha256").update(library).digest("hex").slice(0, 16)
  return path.join(repoRoot, "target", "debug", `palamedes-node-test-support-${digest}.node`)
}
