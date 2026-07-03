import { cp, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

export const DEFAULT_SEED = 20_260_703

export const PROFILE_DEFINITIONS = {
  small: {
    fileCount: 80,
    messagesPerFile: 8,
    changedCount: 48,
    newCount: 64,
    removedCount: 48,
  },
  medium: {
    fileCount: 240,
    messagesPerFile: 8,
    changedCount: 144,
    newCount: 192,
    removedCount: 144,
  },
  large: {
    fileCount: 720,
    messagesPerFile: 8,
    changedCount: 432,
    newCount: 576,
    removedCount: 432,
  },
}

const AREAS = ["queue", "billing", "review", "reporting", "settings", "timeline", "portal", "audit"]
const ACTIONS = ["approve", "publish", "archive", "sync", "route", "stage", "assign", "close"]
const SURFACES = ["toolbar", "panel", "modal", "summary", "sidebar", "header", "detail", "overview"]
const linguiFormatPoImport = JSON.stringify(import.meta.resolve("@lingui/format-po"))

export async function createWorkflowCorpus({ profileName, rootDir, seed = DEFAULT_SEED }) {
  const profile = PROFILE_DEFINITIONS[profileName]

  if (!profile) {
    throw new Error(`Unknown workflow benchmark profile: ${profileName}`)
  }

  const messageCount = profile.fileCount * profile.messagesPerFile
  const generated = createMessageInventory({ messageCount, profile, seed })
  const profileRoot = path.join(rootDir, profileName)
  const toolRoots = {
    palamedes: path.join(profileRoot, "palamedes"),
    lingui: path.join(profileRoot, "lingui"),
    i18next: path.join(profileRoot, "i18next"),
  }

  await Promise.all(
    Object.values(toolRoots).map((toolRoot) =>
      mkdir(path.join(toolRoot, "src", "generated"), { recursive: true })
    )
  )

  await Promise.all([
    writePalamedesWorkspace(toolRoots.palamedes, generated, profile),
    writeLinguiWorkspace(toolRoots.lingui, generated, profile),
    writeI18nextWorkspace(toolRoots.i18next, generated, profile),
  ])

  return {
    profileName,
    seed,
    roots: toolRoots,
    fileCount: profile.fileCount,
    messagesPerFile: profile.messagesPerFile,
    sourceMessageCount: generated.sourceMessages.length,
    baselineMessageCount: generated.baselineMessages.length,
    currentMessages: generated.sourceMessages.map((message) => message.current),
    baselineMessages: generated.baselineMessages,
    changedCount: profile.changedCount,
    newCount: profile.newCount,
    removedCount: profile.removedCount,
    sourceBytes: generated.sourceBytes,
  }
}

function createMessageInventory({ messageCount, profile, seed }) {
  const sourceMessages = []
  const baselineMessages = []
  const newStart = profile.changedCount
  const stableStart = profile.changedCount + profile.newCount

  for (let index = 0; index < messageCount; index += 1) {
    const current = makeMessage(seed, index, "current")

    if (index < newStart) {
      const previous = makeMessage(seed, index, "previous")
      sourceMessages.push({ current, previous, state: "changed" })
      baselineMessages.push(previous)
    } else if (index < stableStart) {
      sourceMessages.push({ current, previous: null, state: "new" })
    } else {
      sourceMessages.push({ current, previous: current, state: "unchanged" })
      baselineMessages.push(current)
    }
  }

  for (let index = 0; index < profile.removedCount; index += 1) {
    baselineMessages.push(makeRemovedMessage(seed, index))
  }

  const sourceBytes = sourceMessages.reduce(
    (sum, entry) => sum + Buffer.byteLength(entry.current),
    0
  )

  return {
    sourceMessages,
    baselineMessages,
    sourceBytes,
  }
}

async function writePalamedesWorkspace(rootDir, inventory, profile) {
  await writeFile(
    path.join(rootDir, "palamedes.yaml"),
    [
      "locales: [en, de]",
      "source-locale: en",
      "source-reference-root: config",
      "catalogs:",
      "  - path: src/locales/{locale}",
      "    include: [src/generated]",
      "",
    ].join("\n"),
    "utf8"
  )
  await writeToolSourceFiles(rootDir, inventory.sourceMessages, profile, renderPalamedesSource)
  await writePoCatalogs(rootDir, inventory.baselineMessages, "palamedes-e2e-workflow")
}

async function writeLinguiWorkspace(rootDir, inventory, profile) {
  await writeFile(
    path.join(rootDir, "lingui.config.mjs"),
    [
      `import { formatter } from ${linguiFormatPoImport}`,
      "",
      "export default {",
      '  locales: ["en", "de"],',
      '  sourceLocale: "en",',
      "  format: formatter({ origins: false, lineNumbers: false }),",
      "  catalogs: [",
      '    { path: "src/locales/{locale}", include: ["src/generated"] },',
      "  ],",
      "}",
      "",
    ].join("\n"),
    "utf8"
  )
  await writeToolSourceFiles(rootDir, inventory.sourceMessages, profile, renderLinguiSource)
  await writePoCatalogs(rootDir, inventory.baselineMessages, "lingui-e2e-workflow")
}

async function writeI18nextWorkspace(rootDir, inventory, profile) {
  await writeFile(
    path.join(rootDir, "i18next-parser.config.cjs"),
    [
      "module.exports = {",
      '  input: ["src/generated/**/*.{ts,tsx}"],',
      '  output: "src/locales/$LOCALE/translation.json",',
      '  locales: ["en", "de"],',
      '  defaultNamespace: "translation",',
      "  createOldCatalogs: false,",
      "  keySeparator: false,",
      "  namespaceSeparator: false,",
      "  pluralSeparator: false,",
      "  contextSeparator: false,",
      "  sort: true,",
      '  lexers: { ts: ["JavascriptLexer"], tsx: ["JsxLexer"] },',
      "}",
      "",
    ].join("\n"),
    "utf8"
  )
  await writeToolSourceFiles(rootDir, inventory.sourceMessages, profile, renderI18nextSource)
  await writeJsonCatalogs(rootDir, inventory.baselineMessages)
}

async function writeToolSourceFiles(rootDir, sourceMessages, profile, renderer) {
  const files = Array.from({ length: profile.fileCount }, (_, fileIndex) => [])

  for (let index = 0; index < sourceMessages.length; index += 1) {
    files[Math.floor(index / profile.messagesPerFile)].push(sourceMessages[index])
  }

  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    const extension = fileIndex % 3 === 0 ? "tsx" : "ts"
    const filename = path.join(
      rootDir,
      "src",
      "generated",
      `fixture-${String(fileIndex).padStart(4, "0")}.${extension}`
    )
    await writeFile(filename, renderer(fileIndex, files[fileIndex], extension), "utf8")
  }
}

function renderPalamedesSource(fileIndex, messages, extension) {
  const imports = ['import { defineMessage, t } from "@palamedes/core/macro"']
  if (extension === "tsx") {
    imports.push('import { Trans } from "@palamedes/react/macro"')
  }

  return renderMacroSource({
    functionName: `palamedesFixture${String(fileIndex).padStart(4, "0")}`,
    imports,
    messages,
    extension,
  })
}

function renderLinguiSource(fileIndex, messages, extension) {
  const imports = ['import { defineMessage, t } from "@lingui/core/macro"']
  if (extension === "tsx") {
    imports.push('import { Trans } from "@lingui/react/macro"')
  }

  return renderMacroSource({
    functionName: `linguiFixture${String(fileIndex).padStart(4, "0")}`,
    imports,
    messages,
    extension,
  })
}

function renderMacroSource({ functionName, imports, messages, extension }) {
  const lines = [...imports, "", `export function ${functionName}() {`, "  const values = ["]

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index].current
    if (index % 3 === 0) {
      lines.push(`    t({ message: ${JSON.stringify(message)} }),`)
    } else {
      lines.push(`    defineMessage({ message: ${JSON.stringify(message)} }).message,`)
    }
  }

  lines.push("  ]")

  if (extension === "tsx") {
    lines.push(
      "  return (",
      "    <section>",
      `      <Trans>${escapeJsxText(messages[0].current)}</Trans>`,
      "      <span>{values.length}</span>",
      "    </section>",
      "  )"
    )
  } else {
    lines.push('  return values.join("\\n")')
  }

  lines.push("}", "")
  return lines.join("\n")
}

function renderI18nextSource(fileIndex, messages, extension) {
  const lines = [
    'import i18next from "i18next"',
    "",
    `export function i18nextFixture${String(fileIndex).padStart(4, "0")}() {`,
    "  const values = [",
  ]

  for (const entry of messages) {
    lines.push(`    i18next.t(${JSON.stringify(entry.current)}),`)
  }

  lines.push("  ]")

  if (extension === "tsx") {
    lines.push('  return <section>{values.join("\\\\n")}</section>')
  } else {
    lines.push('  return values.join("\\n")')
  }

  lines.push("}", "")
  return lines.join("\n")
}

async function writePoCatalogs(rootDir, messages, generator) {
  const localeRoot = path.join(rootDir, "src", "locales")
  await mkdir(localeRoot, { recursive: true })
  await Promise.all([
    writeFile(path.join(localeRoot, "en.po"), renderPo("en", messages, generator), "utf8"),
    writeFile(path.join(localeRoot, "de.po"), renderPo("de", messages, generator), "utf8"),
  ])
  await cp(localeRoot, path.join(rootDir, ".baseline-locales"), { recursive: true })
}

async function writeJsonCatalogs(rootDir, messages) {
  const localeRoot = path.join(rootDir, "src", "locales")
  const enDir = path.join(localeRoot, "en")
  const deDir = path.join(localeRoot, "de")
  await Promise.all([mkdir(enDir, { recursive: true }), mkdir(deDir, { recursive: true })])
  await Promise.all([
    writeFile(
      path.join(enDir, "translation.json"),
      `${JSON.stringify(toJsonCatalog(messages, "en"), null, 2)}\n`,
      "utf8"
    ),
    writeFile(
      path.join(deDir, "translation.json"),
      `${JSON.stringify(toJsonCatalog(messages, "de"), null, 2)}\n`,
      "utf8"
    ),
  ])
  await cp(localeRoot, path.join(rootDir, ".baseline-locales"), { recursive: true })
}

function renderPo(locale, messages, generator) {
  const lines = [
    'msgid ""',
    'msgstr ""',
    `"Language: ${locale}\\n"`,
    '"Content-Type: text/plain; charset=utf-8\\n"',
    '"Content-Transfer-Encoding: 8bit\\n"',
    `"X-Generator: ${generator}\\n"`,
    "",
  ]

  for (const message of messages) {
    lines.push(`msgid ${quotePo(message)}`)
    lines.push(`msgstr ${quotePo(translate(locale, message))}`)
    lines.push("")
  }

  return lines.join("\n")
}

function toJsonCatalog(messages, locale) {
  return Object.fromEntries(messages.map((message) => [message, translate(locale, message)]))
}

function translate(locale, message) {
  return locale === "en" ? message : `[de] ${message}`
}

function makeMessage(seed, index, variant) {
  const area = pick(AREAS, seed, index, 1)
  const action = pick(ACTIONS, seed, index, 2)
  const surface = pick(SURFACES, seed, index, 3)
  const token = `${String(index).padStart(5, "0")}-${variant === "previous" ? "old" : "now"}`
  return `${capitalize(action)} ${area} ${surface} item ${token}`
}

function makeRemovedMessage(seed, index) {
  const area = pick(AREAS, seed, index, 4)
  const surface = pick(SURFACES, seed, index, 5)
  return `Remove stale ${area} ${surface} item ${String(index).padStart(5, "0")}`
}

function pick(values, seed, index, salt) {
  return values[Math.abs(numberHash(seed + index * 33 + salt * 97)) % values.length]
}

function numberHash(value) {
  let state = value >>> 0
  state ^= state << 13
  state ^= state >>> 17
  state ^= state << 5
  return state | 0
}

function quotePo(value) {
  return `"${value.replaceAll(/\\/g, "\\\\").replaceAll(/"/g, '\\"').replaceAll(/\n/g, "\\n")}"`
}

function escapeJsxText(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

function capitalize(value) {
  return value.slice(0, 1).toUpperCase() + value.slice(1)
}
