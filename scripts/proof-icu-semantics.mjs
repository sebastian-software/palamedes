import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const fixtureRoot = path.join(repoRoot, "proof", "icu-semantics")
const fixtureSourcePath = path.join(fixtureRoot, "src", "notification-summary.ts")
const fixtureSourceName = "proof/icu-semantics/src/notification-summary.ts"
const fixtureTranslationPath = path.join(fixtureRoot, "locales", "de", "messages.po")
const expected = JSON.parse(await readFile(path.join(fixtureRoot, "expected.json"), "utf8"))
const runtimeSymbolName = "palamedes.icu-semantics-proof.i18n"
const runtimeSymbol = Symbol.for(runtimeSymbolName)

const coreNode = await import(
  pathToFileURL(path.join(repoRoot, "packages", "core-node", "dist", "index.mjs")).href
)
const core = await import(
  pathToFileURL(path.join(repoRoot, "packages", "core", "dist", "index.mjs")).href
)

const {
  compileCatalogArtifact,
  extractMessagesNative,
  parsePo,
  transformMacrosNative,
  updateCatalogFile,
} = coreNode
const { createI18n, parseMessagePattern } = core

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "palamedes-icu-proof-"))

try {
  const source = await readFile(fixtureSourcePath, "utf8")
  const extracted = extractMessagesNative(source, fixtureSourceName)

  assert.equal(extracted.length, 1, "the fixture must extract exactly one message")
  assert.equal(extracted[0].message, expected.message, "extraction changed the ICU source")
  assert.equal(extracted[0].context, expected.context, "extraction changed the message context")

  const transformedModulePath = path.join(tempRoot, "notification-summary.mjs")
  const runtimeBridgePath = path.join(tempRoot, "runtime-bridge.mjs")
  const transformed = transformMacrosNative(source, fixtureSourceName, {
    runtimeModule: "./runtime-bridge.mjs",
    runtimeImportName: "getI18n",
  })

  assert.equal(transformed.hasChanged, true, "the source fixture was not transformed")
  assert.equal(
    transformed.compiledIds.length,
    1,
    "the transformed fixture must reference one compiled message"
  )
  await writeFile(transformedModulePath, transformed.code, "utf8")
  await writeFile(
    runtimeBridgePath,
    `const proofI18nKey = Symbol.for(${JSON.stringify(runtimeSymbolName)})
export function getI18n() {
  const i18n = globalThis[proofI18nKey]
  if (!i18n) throw new Error("ICU proof runtime is not installed")
  return i18n
}
`,
    "utf8"
  )

  const messages = extracted.map((message) => ({
    message: message.message,
    context: message.context,
    placeholders: toCatalogPlaceholders(message.placeholders),
    extractedComments: message.comment ? [message.comment] : [],
    origins: [
      {
        file: message.origin[0],
        line: message.origin[1],
        scope: message.origin.scope,
      },
    ],
  }))

  const enCatalogPath = path.join(tempRoot, "locales", "en", "messages.po")
  const deCatalogPath = path.join(tempRoot, "locales", "de", "messages.po")
  await mkdir(path.dirname(enCatalogPath), { recursive: true })
  await mkdir(path.dirname(deCatalogPath), { recursive: true })

  updateCatalogFile({
    targetPath: enCatalogPath,
    locale: "en",
    sourceLocale: "en",
    clean: true,
    messages,
  })
  await copyFile(fixtureTranslationPath, deCatalogPath)
  updateCatalogFile({
    targetPath: deCatalogPath,
    locale: "de",
    sourceLocale: "en",
    clean: true,
    messages,
  })

  const sourceEntry = onlyMessage(parsePo(await readFile(enCatalogPath, "utf8")))
  const translatedEntry = onlyMessage(parsePo(await readFile(deCatalogPath, "utf8")))

  assert.equal(sourceEntry.msgid, expected.message, "the PO source message changed")
  assert.equal(sourceEntry.msgctxt, expected.context, "the PO source context changed")
  assert.equal(translatedEntry.msgid, expected.message, "the translated PO source changed")
  assert.equal(translatedEntry.msgctxt, expected.context, "the translated PO context changed")
  assert.deepEqual(
    translatedEntry.msgstr,
    [expected.translation],
    "the translated ICU message changed during the catalog update"
  )

  assert.deepEqual(
    semanticShape(parseMessagePattern(expected.translation)),
    semanticShape(parseMessagePattern(expected.message)),
    "the translation changed the ICU selector structure"
  )

  const artifact = compileCatalogArtifact(
    {
      rootDir: tempRoot,
      locales: ["en", "de"],
      sourceLocale: "en",
      catalogs: [{ path: "locales/{locale}/messages", include: ["src"] }],
    },
    deCatalogPath
  )

  assert.deepEqual(artifact.missing, [], "the compiled catalog contains missing messages")
  assert.deepEqual(
    artifact.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
    [],
    "the compiled catalog contains ICU errors"
  )

  const compiledEntries = Object.entries(artifact.messages)
  assert.equal(compiledEntries.length, 1, "the compiled catalog must contain one message")
  const [compiledId, compiledMessage] = compiledEntries[0]
  assert.equal(
    transformed.compiledIds[0],
    compiledId,
    "the macro transform and catalog compiler produced different message IDs"
  )
  assert.equal(compiledMessage, expected.translation, "catalog compilation changed the translation")

  const i18n = createI18n()
  i18n.load("de", artifact.messages)
  i18n.activate("de")

  globalThis[runtimeSymbol] = i18n
  try {
    const fixtureModule = await import(pathToFileURL(transformedModulePath).href)
    assert.equal(
      typeof fixtureModule.notificationSummary,
      "function",
      "the transformed fixture did not export its runtime function"
    )

    for (const scenario of expected.scenarios) {
      assert.equal(
        fixtureModule.notificationSummary(scenario.values.role, scenario.values.count),
        scenario.output,
        `runtime output changed for ${JSON.stringify(scenario.values)}`
      )
    }
  } finally {
    delete globalThis[runtimeSymbol]
  }

  console.log(
    JSON.stringify(
      {
        status: "passed",
        pipeline: ["source", "extraction", "transform", "po-catalog", "compile", "runtime"],
        messageSha256: sha256(expected.message),
        translationSha256: sha256(expected.translation),
        selectorShape: semanticShape(parseMessagePattern(expected.message)),
        runtimeScenarios: expected.scenarios.length,
      },
      null,
      2
    )
  )
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}

function onlyMessage(catalog) {
  assert.equal(catalog.items.length, 1, "the proof catalog must contain exactly one message")
  return catalog.items[0]
}

function toCatalogPlaceholders(placeholders) {
  if (!placeholders) {
    return
  }

  return Object.fromEntries(Object.entries(placeholders).map(([name, value]) => [name, [value]]))
}

function semanticShape(nodes) {
  return nodes.map((node) => {
    switch (node.type) {
      case "text":
        return {
          type: "text",
          poundSigns: [...node.value].filter((character) => character === "#").length,
        }
      case "variable":
        return { type: "variable", variable: node.variable }
      case "formatted":
        return {
          type: "formatted",
          variable: node.variable,
          format: node.format,
          style: node.style ?? null,
        }
      case "tag":
        return {
          type: "tag",
          name: node.name,
          children: semanticShape(node.children),
        }
      case "choice":
        return {
          type: "choice",
          variable: node.variable,
          kind: node.kind,
          offset: node.offset ?? 0,
          options: Object.fromEntries(
            Object.entries(node.options)
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([key, children]) => [key, semanticShape(children)])
          ),
        }
    }

    throw new Error(`Unsupported ICU node type: ${node.type}`)
  })
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
