import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"

import chalk from "chalk"
import {
  loadPalamedesConfig,
  resolveCatalogPath,
  type LoadedPalamedesConfig,
} from "@palamedes/config"
import { parsePo, type ParsedPoItem } from "@palamedes/core-node"

export interface XliffExportOptions {
  config?: string
  locale: string
  output: string
}

export interface XliffImportOptions {
  config?: string
  locale?: string
  output?: string
}

export interface XliffExportResult {
  outputPath: string
  locale: string
  files: number
  units: number
}

export interface XliffImportResult {
  locale: string
  files: number
  units: number
  updated: number
  unchanged: number
  skipped: number
}

interface CatalogExportFile {
  original: string
  units: XliffUnit[]
}

interface ParsedXliffFile {
  original?: string
  sourceLanguage?: string
  targetLanguage?: string
  units: XliffUnit[]
}

interface XliffUnit {
  id?: string
  source: string
  target?: string
  context?: string
  state?: string
}

interface PoMergeResult {
  content: string
  updated: number
  unchanged: number
  skipped: number
}

export async function exportXliff(
  options: XliffExportOptions
): Promise<XliffExportResult> {
  if (!options.locale) {
    throw new Error("Missing required --locale value.")
  }
  if (!options.output) {
    throw new Error("Missing required --output path.")
  }

  const config = await loadPalamedesConfig({ configPath: options.config })
  assertConfiguredLocale(config, options.locale)

  const files: CatalogExportFile[] = []
  let unitCount = 0

  for (const catalogPath of resolveLocaleCatalogPaths(config, options.locale)) {
    const content = await readFile(catalogPath, "utf8")
    const parsed = parsePo(content)
    const units = parsed.items
      .filter((item) => item.msgid.length > 0 && !item.obsolete)
      .map(itemToXliffUnit)

    unitCount += units.length
    files.push({
      original: relativeCatalogPath(config, catalogPath),
      units,
    })
  }

  const outputPath = path.resolve(options.output)
  await writeFile(
    outputPath,
    formatXliffDocument(config.sourceLocale, options.locale, files),
    "utf8"
  )

  console.log(
    chalk.green("OK"),
    `Exported ${unitCount} XLIFF unit(s) for ${options.locale} to ${outputPath}`
  )

  return {
    outputPath,
    locale: options.locale,
    files: files.length,
    units: unitCount,
  }
}

export async function importXliff(
  inputPath: string,
  options: XliffImportOptions = {}
): Promise<XliffImportResult> {
  if (!inputPath) {
    throw new Error("Missing required XLIFF input path.")
  }

  const config = await loadPalamedesConfig({ configPath: options.config })
  const input = await readFile(inputPath, "utf8")
  const files = parseXliffDocument(input)
  const locale = resolveImportLocale(files, options.locale)
  assertConfiguredLocale(config, locale)

  const targetFiles = files.map((file) =>
    resolveImportTargetPath(config, file, locale, options, files.length)
  )
  const mergedFiles = await Promise.all(
    files.map(async (file, index) => {
      const targetPath = targetFiles[index]
      const existing = await readFile(targetPath, "utf8")
      return {
        targetPath,
        result: mergeXliffUnitsIntoPo(existing, file.units),
      }
    })
  )

  let updated = 0
  let unchanged = 0
  let skipped = 0
  let units = 0

  for (const file of mergedFiles) {
    units += file.result.updated + file.result.unchanged + file.result.skipped
    updated += file.result.updated
    unchanged += file.result.unchanged
    skipped += file.result.skipped
  }

  for (const file of mergedFiles) {
    await writeFile(file.targetPath, file.result.content, "utf8")
  }

  console.log(
    chalk.green("OK"),
    `Imported ${updated} changed XLIFF unit(s) for ${locale}`
  )

  return {
    locale,
    files: files.length,
    units,
    updated,
    unchanged,
    skipped,
  }
}

function assertConfiguredLocale(
  config: LoadedPalamedesConfig,
  locale: string
): void {
  if (!config.locales.includes(locale)) {
    throw new Error(
      `Locale ${locale} is not configured. Expected one of: ${config.locales.join(", ")}.`
    )
  }
}

function resolveLocaleCatalogPaths(
  config: LoadedPalamedesConfig,
  locale: string
): string[] {
  return (config.catalogs ?? []).map(
    (catalog) => `${resolveCatalogPath(config, catalog.path, locale)}.po`
  )
}

function itemToXliffUnit(item: ParsedPoItem): XliffUnit {
  return {
    id: unitId(item.msgid, item.msgctxt),
    source: item.msgid,
    target: item.msgstr[0] ?? "",
    context: item.msgctxt,
    state: targetStateForItem(item),
  }
}

function targetStateForItem(item: ParsedPoItem): string {
  if (item.flags.fuzzy) {
    return "needs-review-translation"
  }
  if ((item.msgstr[0] ?? "").length === 0) {
    return "needs-translation"
  }
  return "translated"
}

function unitId(source: string, context: string | undefined): string {
  return createHash("sha256")
    .update(`${context ?? ""}\0${source}`)
    .digest("hex")
    .slice(0, 16)
}

function relativeCatalogPath(
  config: LoadedPalamedesConfig,
  catalogPath: string
): string {
  return path.relative(config.rootDir, catalogPath).split(path.sep).join("/")
}

function formatXliffDocument(
  sourceLocale: string,
  targetLocale: string,
  files: CatalogExportFile[]
): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">',
  ]

  for (const file of files) {
    lines.push(
      `  <file original="${escapeXmlAttribute(file.original)}" source-language="${escapeXmlAttribute(sourceLocale)}" target-language="${escapeXmlAttribute(targetLocale)}" datatype="plaintext">`,
      "    <body>"
    )

    for (const unit of file.units) {
      const resname = unit.context
        ? ` resname="${escapeXmlAttribute(unit.context)}"`
        : ""
      lines.push(
        `      <trans-unit id="${escapeXmlAttribute(unit.id ?? unitId(unit.source, unit.context))}"${resname}>`,
        `        <source>${escapeXmlText(unit.source)}</source>`,
        `        <target state="${escapeXmlAttribute(unit.state ?? "translated")}">${escapeXmlText(unit.target ?? "")}</target>`
      )

      if (unit.context) {
        lines.push(
          `        <note from="palamedes-context">${escapeXmlText(unit.context)}</note>`
        )
      }

      lines.push("      </trans-unit>")
    }

    lines.push("    </body>", "  </file>")
  }

  lines.push("</xliff>")
  return `${lines.join("\n")}\n`
}

function parseXliffDocument(content: string): ParsedXliffFile[] {
  const files = collectElements(content, "file").map((fileElement) => {
    const attrs = parseAttributes(fileElement.attributes)
    return {
      original: attrs.original,
      sourceLanguage: attrs["source-language"],
      targetLanguage: attrs["target-language"],
      units: collectElements(fileElement.body, "trans-unit").map((unitElement) => {
        const unitAttrs = parseAttributes(unitElement.attributes)
        const source = firstElementText(unitElement.body, "source")
        if (source === undefined) {
          throw new Error("Invalid XLIFF: trans-unit is missing <source>.")
        }

        const target = firstElement(unitElement.body, "target")
        const notes = collectElements(unitElement.body, "note")
        const contextNote = notes.find((note) => {
          const noteAttrs = parseAttributes(note.attributes)
          return noteAttrs.from === "palamedes-context"
        })

        return {
          id: unitAttrs.id,
          source,
          target: target ? decodeXmlBody(target.body) : undefined,
          context: contextNote
            ? decodeXmlBody(contextNote.body)
            : unitAttrs.resname,
          state: target
            ? parseAttributes(target.attributes).state
            : undefined,
        }
      }),
    }
  })

  if (files.length === 0) {
    throw new Error("Invalid XLIFF: no <file> elements found.")
  }

  return files
}

function resolveImportLocale(
  files: ParsedXliffFile[],
  localeOverride: string | undefined
): string {
  if (localeOverride) {
    return localeOverride
  }

  const locales = new Set(
    files
      .map((file) => file.targetLanguage)
      .filter((locale): locale is string => Boolean(locale))
  )

  if (locales.size === 1) {
    return [...locales][0]
  }

  throw new Error(
    "Could not infer import locale from XLIFF target-language. Pass --locale."
  )
}

function resolveImportTargetPath(
  config: LoadedPalamedesConfig,
  file: ParsedXliffFile,
  locale: string,
  options: XliffImportOptions,
  fileCount: number
): string {
  if (options.output) {
    if (fileCount > 1) {
      throw new Error("--output can only be used when importing one XLIFF file.")
    }
    return path.resolve(options.output)
  }

  if (file.original) {
    const targetPath = path.isAbsolute(file.original)
      ? path.resolve(file.original)
      : path.resolve(config.rootDir, file.original)
    assertPathInsideRoot(config.rootDir, targetPath)
    return targetPath
  }

  const catalogPaths = resolveLocaleCatalogPaths(config, locale)
  if (catalogPaths.length === 1) {
    return catalogPaths[0]
  }

  throw new Error(
    "XLIFF file is missing original catalog path. Pass --output or export from Palamedes first."
  )
}

function assertPathInsideRoot(rootDir: string, targetPath: string): void {
  const root = path.resolve(rootDir)
  const relative = path.relative(root, targetPath)
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return
  }

  throw new Error("XLIFF original catalog path escapes the configured rootDir.")
}

function mergeXliffUnitsIntoPo(content: string, units: XliffUnit[]): PoMergeResult {
  const updates = normalizeImportUnits(units)
  const blocks = content.trimEnd().split(/\n{2,}/)
  let updated = 0
  let unchanged = 0
  let skipped = 0

  const nextBlocks = blocks.map((block) => {
    const item = parsePoBlock(block)
    if (!item || item.obsolete) {
      return block
    }

    const update = updates.get(messageKey(item.msgid, item.msgctxt))
    if (!update || update.target === undefined) {
      return block
    }

    updates.delete(messageKey(item.msgid, item.msgctxt))

    const oldTarget = item.msgstr[0] ?? ""
    const oldNeedsReview = Boolean(item.flags.fuzzy)
    const nextNeedsReview = isNeedsReviewState(update.state)

    if (oldTarget === update.target && oldNeedsReview === nextNeedsReview) {
      unchanged += 1
      return block
    }

    updated += 1
    return setFuzzyFlag(
      replaceMsgstr(block, update.target),
      nextNeedsReview
    )
  })

  skipped = [...updates.values()].filter((unit) => unit.target !== undefined).length

  return {
    content: `${nextBlocks.join("\n\n")}\n`,
    updated,
    unchanged,
    skipped,
  }
}

function normalizeImportUnits(units: XliffUnit[]): Map<string, XliffUnit> {
  const updates = new Map<string, XliffUnit>()

  for (const unit of units) {
    const key = messageKey(unit.source, unit.context)
    const existing = updates.get(key)
    if (
      existing &&
      existing.target !== undefined &&
      unit.target !== undefined &&
      existing.target !== unit.target
    ) {
      throw new Error(
        `Conflicting XLIFF targets for message ${JSON.stringify(unit.source)}.`
      )
    }

    updates.set(key, {
      ...unit,
      target: unit.target ?? existing?.target,
      state:
        isNeedsReviewState(existing?.state) || isNeedsReviewState(unit.state)
          ? "needs-review-translation"
          : unit.state ?? existing?.state,
    })
  }

  return updates
}

function parsePoBlock(block: string): ParsedPoItem | undefined {
  try {
    return parsePo(`${block}\n`).items.find((item) => item.msgid.length > 0)
  } catch {
    return undefined
  }
}

function replaceMsgstr(block: string, target: string): string {
  const pattern = /^msgstr(?:\[\d+\])? "(?:[^"\\]|\\.)*"(?:\n"(?:[^"\\]|\\.)*")*/m
  const match = block.match(pattern)
  if (!match) {
    throw new Error("Could not update PO entry: missing msgstr.")
  }
  return block.replace(pattern, formatPoString(msgstrKeyword(match[0]), target))
}

function msgstrKeyword(value: string): string {
  return value.match(/^msgstr\[\d+\]/)?.[0] ?? "msgstr"
}

function setFuzzyFlag(block: string, enabled: boolean): string {
  const lines = block.split("\n")
  const flagIndex = lines.findIndex((line) => line.startsWith("#,"))
  const flags =
    flagIndex === -1
      ? []
      : lines[flagIndex]
          .slice(2)
          .split(",")
          .map((flag) => flag.trim())
          .filter(Boolean)

  const nextFlags = enabled
    ? [...new Set([...flags, "fuzzy"])]
    : flags.filter((flag) => flag !== "fuzzy")

  if (flagIndex !== -1) {
    if (nextFlags.length > 0) {
      lines[flagIndex] = `#, ${nextFlags.join(", ")}`
    } else {
      lines.splice(flagIndex, 1)
    }
    return lines.join("\n")
  }

  if (!enabled) {
    return block
  }

  const insertAt = lines.findIndex(
    (line) => line.startsWith("msgctxt ") || line.startsWith("msgid ")
  )
  lines.splice(insertAt === -1 ? 0 : insertAt, 0, "#, fuzzy")
  return lines.join("\n")
}

function formatPoString(keyword: string, value: string): string {
  if (!value.includes("\n")) {
    return `${keyword} "${escapePoString(value)}"`
  }

  const lines = value.split("\n")
  return [
    `${keyword} ""`,
    ...lines.map((line, index) => {
      const suffix = index < lines.length - 1 ? "\\n" : ""
      return `"${escapePoString(line)}${suffix}"`
    }),
  ].join("\n")
}

function escapePoString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\t/g, "\\t")
    .replace(/\r/g, "\\r")
    .replace(/"/g, '\\"')
}

function isNeedsReviewState(state: string | undefined): boolean {
  return state === "needs-review-translation" || state === "needs-review-l10n"
}

function messageKey(source: string, context: string | undefined): string {
  return `${context ?? ""}\0${source}`
}

function collectElements(
  content: string,
  name: string
): Array<{ attributes: string; body: string }> {
  const pattern = new RegExp(
    `<(?:[\\w.-]+:)?${name}\\b([^>]*)>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${name}>`,
    "g"
  )
  return [...content.matchAll(pattern)].map((match) => ({
    attributes: match[1],
    body: match[2],
  }))
}

function firstElement(
  content: string,
  name: string
): { attributes: string; body: string } | undefined {
  const element = collectElements(content, name)[0]
  if (element) {
    return element
  }

  const pattern = new RegExp(`<(?:[\\w.-]+:)?${name}\\b([^>]*)\\/\\s*>`)
  const match = content.match(pattern)
  return match
    ? {
        attributes: match[1] ?? "",
        body: "",
      }
    : undefined
}

function firstElementText(content: string, name: string): string | undefined {
  const element = firstElement(content, name)
  return element ? decodeXmlBody(element.body) : undefined
}

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const pattern = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  for (const match of source.matchAll(pattern)) {
    attrs[match[1]] = decodeXmlEntities(match[2] ?? match[3] ?? "")
  }
  return attrs
}

function decodeXmlBody(value: string): string {
  return decodeXmlEntities(
    value
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<[^>]+>/g, "")
  )
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    )
    .replace(/&#(\d+);/g, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10))
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replace(/"/g, "&quot;")
}
