import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import path from "node:path"

import { runCommand } from "./exec.mjs"

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
  /*
   * Models a real web app's extract-time parse volume (measured from the Lingui
   * include roots of a production app): most source is NOT i18n. Only ~46% of
   * files carry any i18n marker, and only ~3% of lines are i18n — the extractor
   * still has to scan every line of the rest. Message shape is plain + ~15%
   * {name} variables (no plurals yet — see issue #355 / PR #358).
   */
  realistic: {
    layout: "realistic",
    messages: 6000,
    markedFiles: 750,
    unmarkedFiles: 750,
    markedFileLines: 374,
    unmarkedFileLines: 160,
    changedCount: 450,
    newCount: 600,
    removedCount: 450,
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

export async function createWorkflowCorpus({
  profileName,
  rootDir,
  seed = DEFAULT_SEED,
  toolPaths,
}) {
  const profile = PROFILE_DEFINITIONS[profileName]

  if (!profile) {
    throw new Error(`Unknown workflow benchmark profile: ${profileName}`)
  }

  const messageCount = profile.messages ?? profile.fileCount * profile.messagesPerFile
  const generated = createMessageInventory({ messageCount, profile, seed })
  const profileRoot = path.join(rootDir, profileName)
  const toolRoots = {
    palamedes: path.join(profileRoot, "palamedes"),
    lingui: path.join(profileRoot, "lingui"),
    formatjs: path.join(profileRoot, "formatjs"),
    i18nextCli: path.join(profileRoot, "i18next-cli"),
    gt: path.join(profileRoot, "gt"),
  }

  await Promise.all(
    Object.values(toolRoots).map((toolRoot) =>
      mkdir(path.join(toolRoot, "src", "generated"), { recursive: true })
    )
  )

  await Promise.all([
    writePalamedesWorkspace(toolRoots.palamedes, generated, profile),
    writeLinguiWorkspace(toolRoots.lingui, generated, profile),
    writeFormatJsWorkspace(toolRoots.formatjs, generated, profile),
    writeI18nextCliWorkspace(toolRoots.i18nextCli, generated, profile),
    writeGtWorkspace(toolRoots.gt, generated, profile, toolPaths?.gt),
  ])

  const fileCount =
    profile.layout === "realistic" ? profile.markedFiles + profile.unmarkedFiles : profile.fileCount

  return {
    profileName,
    seed,
    roots: toolRoots,
    fileCount,
    messagesPerFile: profile.messagesPerFile ?? Math.round(messageCount / fileCount),
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

async function writeFormatJsWorkspace(rootDir, inventory, profile) {
  await writeToolSourceFiles(rootDir, inventory.sourceMessages, profile, renderFormatJsSource)
  await writeFormatJsCatalog(rootDir, inventory.baselineMessages)
}

async function writeI18nextCliWorkspace(rootDir, inventory, profile) {
  await writeFile(
    path.join(rootDir, "i18next.config.mjs"),
    [
      "export default {",
      '  locales: ["en", "de"],',
      "  extract: {",
      '    input: ["src/generated/**/*.{ts,tsx}"],',
      '    output: "src/locales/{{language}}/{{namespace}}.json",',
      '    primaryLanguage: "en",',
      '    defaultNS: "translation",',
      "    keySeparator: false,",
      "    nsSeparator: false,",
      "    sort: true,",
      "    removeUnusedKeys: true,",
      "  },",
      "}",
      "",
    ].join("\n"),
    "utf8"
  )
  await writeToolSourceFiles(rootDir, inventory.sourceMessages, profile, renderI18nextSource)
  await writeJsonCatalogs(rootDir, inventory.baselineMessages)
}

/*
 * General Translation keys its catalogs by a content hash the CLI computes
 * itself, and the hash covers the authoring shape — the same text extracted
 * from `<T>` and from `t()` lands under different keys. Reimplementing that
 * here would couple the corpus to a private hashing detail, so the baseline is
 * derived from a real `gtx-cli generate` run against the finished source tree
 * instead: whatever keys GT produces for the unchanged messages are the keys
 * its own merge will later recognize.
 *
 * Entries that must disappear during the measured run (the previous text of a
 * changed message, and removed messages) get a synthetic key. GT drops stale
 * entries by key lookup alone, so a synthetic key exercises that path exactly
 * like a real one would, and the values stay real message text so the baseline
 * keeps a realistic size.
 */
async function writeGtWorkspace(rootDir, inventory, profile, gtxCliPath) {
  if (!gtxCliPath) {
    throw new Error("The General Translation lane needs a resolved gtx-cli path")
  }

  await writeFile(
    path.join(rootDir, "package.json"),
    `${JSON.stringify(
      {
        name: "gt-e2e-workflow",
        private: true,
        version: "0.0.0",
        dependencies: { "gt-react": await readGtReactVersion() },
      },
      null,
      2
    )}\n`,
    "utf8"
  )
  await writeFile(
    path.join(rootDir, "gt.config.json"),
    `${JSON.stringify(
      {
        defaultLocale: "en",
        locales: ["en", "de"],
        src: ["src/generated/**/*.{js,jsx,ts,tsx}"],
        files: { gt: { output: "src/locales/[locale].json" } },
      },
      null,
      2
    )}\n`,
    "utf8"
  )
  await writeToolSourceFiles(rootDir, inventory.sourceMessages, profile, renderGtSource)

  const localeRoot = path.join(rootDir, "src", "locales")
  await runCommand(gtxCliPath, ["generate", "--quiet"], { cwd: rootDir })
  const currentKeysByMessage = invertGtCatalog(
    JSON.parse(await readFile(path.join(localeRoot, "en.json"), "utf8"))
  )
  await rm(localeRoot, { recursive: true, force: true })

  const baseline = toGtBaselineCatalog(inventory.baselineMessages, currentKeysByMessage)
  await mkdir(localeRoot, { recursive: true })
  await Promise.all(
    ["en", "de"].map((locale) =>
      writeFile(
        path.join(localeRoot, `${locale}.json`),
        `${JSON.stringify(
          Object.fromEntries(
            Object.entries(baseline).map(([key, message]) => [key, translate(locale, message)])
          ),
          null,
          2
        )}\n`,
        "utf8"
      )
    )
  )
  await cp(localeRoot, path.join(rootDir, ".baseline-locales"), { recursive: true })
}

async function readGtReactVersion() {
  const manifest = new URL("../node_modules/gt-react/package.json", import.meta.url)
  try {
    return JSON.parse(await readFile(manifest, "utf8")).version
  } catch {
    throw new Error(
      "Missing gt-react in the benchmark workspace. Run the repo-level benchmark script so dependencies are installed."
    )
  }
}

function invertGtCatalog(catalog) {
  const keysByMessage = new Map()
  for (const [key, message] of Object.entries(catalog)) {
    if (typeof message !== "string") {
      throw new TypeError(
        `General Translation extracted a non-string source for ${key}; the corpus is meant to stay flat`
      )
    }
    if (keysByMessage.has(message)) {
      throw new Error(`General Translation extracted ${JSON.stringify(message)} under two keys`)
    }
    keysByMessage.set(message, key)
  }
  return keysByMessage
}

export function toGtBaselineCatalog(baselineMessages, currentKeysByMessage) {
  const catalog = {}
  for (const message of baselineMessages) {
    const key = currentKeysByMessage.get(message) ?? syntheticGtKey(message)
    if (catalog[key]) {
      throw new Error(`General Translation baseline key collision at ${key}`)
    }
    catalog[key] = message
  }
  return catalog
}

/* Stale entries are only ever looked up by key, so any stable 16-hex key models
 * one. Hashing the raw text keeps it deterministic; GT hashes a structured
 * source descriptor instead, so the two cannot coincide. */
function syntheticGtKey(message) {
  return createHash("sha256").update(`stale:${message}`).digest("hex").slice(0, 16)
}

async function writeToolSourceFiles(rootDir, sourceMessages, profile, renderer) {
  if (profile.layout === "realistic") {
    await writeRealisticSourceFiles(rootDir, sourceMessages, profile, renderer)
    return
  }

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

/*
 * Realistic web layout: messages are spread thinly across `markedFiles`, and
 * `unmarkedFiles` carry no i18n at all — but the extractor still has to scan
 * every line. Both kinds are padded with non-i18n filler to the measured line
 * budgets so the timed workload reflects real parse volume, not a dense
 * all-messages fixture.
 */
async function writeRealisticSourceFiles(rootDir, sourceMessages, profile, renderer) {
  const marked = Array.from({ length: profile.markedFiles }, () => [])
  for (let index = 0; index < sourceMessages.length; index += 1) {
    marked[index % profile.markedFiles].push(sourceMessages[index])
  }

  const generatedDir = path.join(rootDir, "src", "generated")
  /*
   * Pending write thunks, flushed in bounded batches below. All four tool
   * workspaces are generated concurrently, so an unbounded Promise.all here
   * can hold thousands of file descriptors at once and fail with EMFILE on
   * hosts with a conservative open-file limit.
   */
  const writes = []
  let fileIndex = 0

  /* Marked files stay .ts: message calls extract reliably next to filler,
   * whereas .tsx + filler + <Trans> hits a JSX parse edge in the extractor. */
  for (let i = 0; i < profile.markedFiles; i += 1) {
    const filename = path.join(generatedDir, `fixture-${String(fileIndex).padStart(4, "0")}.ts`)
    const renderedIndex = fileIndex
    writes.push(() =>
      writeFile(filename, renderer(renderedIndex, marked[i], "ts", profile.markedFileLines), "utf8")
    )
    fileIndex += 1
  }

  for (let j = 0; j < profile.unmarkedFiles; j += 1) {
    const extension = fileIndex % 3 === 0 ? "tsx" : "ts"
    const filename = path.join(
      generatedDir,
      `fixture-${String(fileIndex).padStart(4, "0")}.${extension}`
    )
    const renderedIndex = fileIndex
    writes.push(() =>
      writeFile(filename, renderFillerModule(renderedIndex, profile.unmarkedFileLines), "utf8")
    )
    fileIndex += 1
  }

  const batchSize = 128
  for (let start = 0; start < writes.length; start += batchSize) {
    await Promise.all(writes.slice(start, start + batchSize).map((write) => write()))
  }
}

const FILLER_UNIT_LINES = 13

/* Deterministic non-i18n source: imports, interfaces and helpers with no
 * translation markers. Emits whole units only (never cuts a declaration in
 * half — that would be a syntax error the extractor bails on), then pads with
 * comment lines to hit `lineCount` exactly so file size stays realistic. */
function fillerLines(fileIndex, lineCount) {
  const lines = ['import { useMemo } from "react"', ""]
  let unit = 0
  while (lines.length + FILLER_UNIT_LINES <= lineCount) {
    const n = unit + 1
    lines.push(
      `interface Record${fileIndex}_${unit} {`,
      "  id: number",
      "  slug: string",
      "  weight: number",
      "}",
      "",
      `export function compute${fileIndex}_${unit}(input: number): Record${fileIndex}_${unit} {`,
      `  const id = (input * ${n} + ${fileIndex}) % 9973`,
      `  const slug = "node-" + id.toString(36) + "-${unit}"`,
      `  const weight = Math.round((id / ${n}) * 100) / 100`,
      "  return { id, slug, weight }",
      "}",
      ""
    )
    unit += 1
  }
  while (lines.length < lineCount) {
    lines.push(`// filler line ${lines.length}`)
  }
  return lines
}

function renderFillerModule(fileIndex, lineCount) {
  return `${fillerLines(fileIndex, lineCount).join("\n")}\n`
}

export function renderPalamedesSource(fileIndex, messages, extension, targetLines) {
  const imports = ['import { t } from "@palamedes/core/macro"']
  if (extension === "tsx") {
    imports.push('import { Trans } from "@palamedes/react/macro"')
  }

  return renderMacroSource({
    functionName: `palamedesFixture${String(fileIndex).padStart(4, "0")}`,
    imports,
    messages,
    extension,
    fileIndex,
    targetLines,
    authorMessage: authorPalamedesMessage,
  })
}

export function renderLinguiSource(fileIndex, messages, extension, targetLines) {
  const imports = ['import { defineMessage, t } from "@lingui/core/macro"']
  if (extension === "tsx") {
    imports.push('import { Trans } from "@lingui/react/macro"')
  }

  return renderMacroSource({
    functionName: `linguiFixture${String(fileIndex).padStart(4, "0")}`,
    imports,
    messages,
    extension,
    fileIndex,
    targetLines,
  })
}

/* Lingui lane: variable messages ({name}) are authored with defineMessage —
 * t({ message }) would drop the interpolation there. Plain messages keep the
 * t/defineMessage mix. */
function authorLinguiMessage(message, index) {
  if (message.includes("{name}") || index % 3 !== 0) {
    return `    defineMessage({ message: ${JSON.stringify(message)} }).message,`
  }
  return `    t({ message: ${JSON.stringify(message)} }),`
}

/*
 * Palamedes lane: eager t({ message }) throughout, which is the post-1.5.0
 * authoring model — deferred message descriptors were removed, so
 * `defineMessage` no longer exists in @palamedes/core/macro and the extractor
 * rejects it outright.
 *
 * Interpolation is not a reason to reach for a deferred macro here: the
 * placeholder is part of the message text, and `t({ message: "Hello {name}" })`
 * lands in the catalog as `msgid "Hello {name}"` unchanged. The two lanes
 * therefore still produce an identical logical message inventory, which is
 * what the harness's semantic validation compares.
 */
function authorPalamedesMessage(message) {
  return `    t({ message: ${JSON.stringify(message)} }),`
}

function renderMacroSource({
  functionName,
  imports,
  messages,
  extension,
  fileIndex,
  targetLines,
  authorMessage = authorLinguiMessage,
}) {
  const body = [`export function ${functionName}() {`, "  const values = ["]

  for (let index = 0; index < messages.length; index += 1) {
    body.push(authorMessage(messages[index].current, index))
  }

  body.push("  ]")

  if (extension === "tsx") {
    /* Trans wraps a plain message — {name} in JSX text would be read as an
     * expression, not message content. */
    const trans = messages.find((entry) => !entry.current.includes("{name}")) ?? messages[0]
    body.push(
      "  return (",
      "    <section>",
      `      <Trans>${escapeJsxText(trans.current)}</Trans>`,
      "      <span>{values.length}</span>",
      "    </section>",
      "  )"
    )
  } else {
    body.push('  return values.join("\\n")')
  }

  body.push("}", "")
  return withFiller(imports, body, fileIndex, targetLines)
}

function renderFormatJsSource(fileIndex, messages, extension, targetLines) {
  const imports = ['import { defineMessages } from "react-intl"']
  if (extension === "tsx") {
    imports[0] = 'import { defineMessages, FormattedMessage } from "react-intl"'
  }

  const body = [
    `export const formatJsMessages${String(fileIndex).padStart(4, "0")} = defineMessages({`,
  ]
  for (let index = 0; index < messages.length; index += 1) {
    body.push(
      `  message${String(index).padStart(4, "0")}: { defaultMessage: ${JSON.stringify(messages[index].current)} },`
    )
  }
  body.push("})", "")

  if (extension === "tsx") {
    const formatted = messages[0]
    body.push(
      `export function FormatJsFixture${String(fileIndex).padStart(4, "0")}() {`,
      "  return (",
      "    <section>",
      `      <FormattedMessage defaultMessage=${JSON.stringify(formatted.current)} />`,
      `      <span>{Object.keys(formatJsMessages${String(fileIndex).padStart(4, "0")}).length}</span>`,
      "    </section>",
      "  )",
      "}",
      ""
    )
  }

  return withFiller(imports, body, fileIndex, targetLines)
}

function renderI18nextSource(fileIndex, messages, extension, targetLines) {
  const imports = ['import i18next from "i18next"']
  const body = [
    `export function i18nextFixture${String(fileIndex).padStart(4, "0")}() {`,
    "  const values = [",
  ]

  for (const entry of messages) {
    body.push(`    i18next.t(${JSON.stringify(entry.current)}),`)
  }

  body.push("  ]")

  if (extension === "tsx") {
    body.push('  return <section>{values.join("\\\\n")}</section>')
  } else {
    body.push('  return values.join("\\n")')
  }

  body.push("}", "")
  return withFiller(imports, body, fileIndex, targetLines)
}

export function renderGtSource(fileIndex, messages, extension, targetLines) {
  const suffix = String(fileIndex).padStart(4, "0")

  /*
   * <T> only wraps a plain message. GT rejects a `{name}` placeholder in JSX
   * children outright — it reads as a runtime expression and the CLI fails with
   * "use a variable component like <Var>" — so a file whose messages are all
   * interpolated keeps its JSX but skips the <T>. The chosen message is then
   * left out of the t() list: GT keys JSX and string content separately, so
   * authoring the same text both ways would put one logical message into the
   * catalog under two keys and break the inventory comparison.
   */
  const transMessage =
    extension === "tsx"
      ? (messages.find((entry) => !entry.current.includes("{name}")) ?? null)
      : null

  const imports = [`import { ${transMessage ? "T, " : ""}useGT } from "gt-react"`]
  const body = [
    `export function ${extension === "tsx" ? "G" : "g"}tFixture${suffix}() {`,
    "  const t = useGT()",
    "  const values = [",
  ]

  for (const entry of messages) {
    if (entry === transMessage) continue
    body.push(`    t(${JSON.stringify(entry.current)}),`)
  }

  body.push("  ]")

  if (extension === "tsx") {
    body.push(
      "  return (",
      "    <section>",
      ...(transMessage ? [`      <T>${escapeJsxText(transMessage.current)}</T>`] : []),
      "      <span>{values.length}</span>",
      "    </section>",
      "  )"
    )
  } else {
    body.push('  return values.join("\\n")')
  }

  body.push("}", "")
  return withFiller(imports, body, fileIndex, targetLines)
}

/* Assemble a source file. In the realistic layout (targetLines set) the message
 * function is padded with non-i18n filler so the file reaches the line budget;
 * otherwise the dense small/medium fixture shape is kept. */
function withFiller(imports, body, fileIndex, targetLines) {
  if (!targetLines) {
    return [...imports, "", ...body].join("\n")
  }
  const fillerCount = Math.max(0, targetLines - imports.length - 1 - body.length)
  return [...imports, "", ...fillerLines(fileIndex, fillerCount), ...body].join("\n")
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

async function writeFormatJsCatalog(rootDir, messages) {
  const localeRoot = path.join(rootDir, "src", "locales")
  await mkdir(localeRoot, { recursive: true })
  await writeFile(
    path.join(localeRoot, "extracted.json"),
    `${JSON.stringify(toFormatJsCatalog(messages), null, 2)}\n`,
    "utf8"
  )
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

export function toFormatJsCatalog(messages) {
  const catalog = {}
  for (const message of messages) {
    const id = formatJsId(message)
    if (catalog[id] && catalog[id].defaultMessage !== message) {
      throw new Error(`React Intl content-hash collision for ${JSON.stringify(message)} at ${id}`)
    }
    catalog[id] = { defaultMessage: message }
  }
  return catalog
}

export function formatJsId(message) {
  return createHash("sha512").update(message).digest("base64").slice(0, 6)
}

function translate(locale, message) {
  return locale === "en" ? message : `[de] ${message}`
}

/* ~15% of messages carry a simple {name} variable, the rest are plain (plurals
 * are deferred — see issue #355 / PR #358). Keyed off index % 100 so the split
 * is exact and stable across the current/previous variants of a message. */
function isVariableMessage(index) {
  return index % 100 < 15
}

function makeMessage(seed, index, variant) {
  const area = pick(AREAS, seed, index, 1)
  const action = pick(ACTIONS, seed, index, 2)
  const surface = pick(SURFACES, seed, index, 3)
  const token = `${String(index).padStart(5, "0")}-${variant === "previous" ? "old" : "now"}`
  if (isVariableMessage(index)) {
    return `${capitalize(action)} ${area} ${surface} for {name} ${token}`
  }
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
