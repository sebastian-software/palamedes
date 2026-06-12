import { readFile } from "node:fs/promises"
import chalk from "chalk"
import {
  loadPalamedesConfig,
  resolveCatalogPath,
  type LoadedPalamedesConfig,
} from "@palamedes/config"
import {
  parsePo,
  type ParsedPoFile,
  type ParsedPoItem,
} from "@palamedes/core-node"

export interface ReportOptions {
  config?: string
  locale?: string[]
  json?: boolean
  failIfBelow?: string
}

export interface LocaleCompletenessReport {
  locale: string
  total: number
  translated: number
  missing: number
  fuzzy: number
  percent: number
}

export interface CompletenessReport {
  locales: LocaleCompletenessReport[]
}

interface MessageKey {
  message: string
  context?: string
}

interface MutableLocaleStats {
  locale: string
  total: number
  translated: number
  missing: number
  fuzzy: number
}

export async function report(options: ReportOptions): Promise<CompletenessReport> {
  const threshold = normalizeThreshold(options.failIfBelow)
  const config = await loadPalamedesConfig({ configPath: options.config })
  const locales = resolveLocales(config, options.locale)
  const result = await buildReport(config, locales)

  if (options.json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    printReport(result)
  }

  if (threshold !== undefined) {
    const failing = result.locales.filter((locale) => locale.percent < threshold)
    if (failing.length > 0) {
      throw new Error(
        `Catalog completeness below ${formatPercent(threshold)} for ${failing
          .map((locale) => `${locale.locale} (${formatPercent(locale.percent)})`)
          .join(", ")}.`
      )
    }
  }

  return result
}

async function buildReport(
  config: LoadedPalamedesConfig,
  locales: string[]
): Promise<CompletenessReport> {
  const stats = new Map<string, MutableLocaleStats>()
  for (const locale of locales) {
    stats.set(locale, {
      locale,
      total: 0,
      translated: 0,
      missing: 0,
      fuzzy: 0,
    })
  }

  for (const catalog of config.catalogs) {
    const sourcePath = `${resolveCatalogPath(config, catalog.path, config.sourceLocale)}.po`
    const sourceCatalog = await readCatalog(sourcePath)
    const sourceMessages = sourceCatalog.items
      .filter(isReportableMessage)
      .map(toMessageKey)

    for (const locale of locales) {
      const localeStats = stats.get(locale)
      if (!localeStats) {
        continue
      }

      localeStats.total += sourceMessages.length

      if (locale === config.sourceLocale) {
        localeStats.translated += sourceMessages.length
        continue
      }

      const targetPath = `${resolveCatalogPath(config, catalog.path, locale)}.po`
      const targetCatalog = await readCatalogIfExists(targetPath)
      const targetMessages = targetCatalog
        ? new Map(
          targetCatalog.items
            .filter(isReportableMessage)
            .map((item) => [serializeMessageKey(toMessageKey(item)), item])
        )
        : new Map<string, ParsedPoItem>()

      for (const sourceMessage of sourceMessages) {
        const target = targetMessages.get(serializeMessageKey(sourceMessage))
        if (!target) {
          localeStats.missing += 1
          continue
        }

        if (target.flags.fuzzy) {
          localeStats.fuzzy += 1
          continue
        }

        if (isTranslated(target)) {
          localeStats.translated += 1
        } else {
          localeStats.missing += 1
        }
      }
    }
  }

  return {
    locales: [...stats.values()].map((locale) => ({
      ...locale,
      percent: locale.total === 0 ? 100 : (locale.translated / locale.total) * 100,
    })),
  }
}

async function readCatalog(catalogPath: string): Promise<ParsedPoFile> {
  return parsePo(await readFile(catalogPath, "utf8"))
}

async function readCatalogIfExists(catalogPath: string): Promise<ParsedPoFile | undefined> {
  try {
    return await readCatalog(catalogPath)
  } catch (error) {
    if (isFileMissing(error)) {
      return undefined
    }
    throw error
  }
}

function isFileMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  )
}

function isReportableMessage(item: ParsedPoItem): boolean {
  return !item.obsolete && item.msgid.length > 0
}

function toMessageKey(item: ParsedPoItem): MessageKey {
  return {
    message: item.msgid,
    ...(item.msgctxt ? { context: item.msgctxt } : {}),
  }
}

function serializeMessageKey(key: MessageKey): string {
  return `${key.context ?? ""}\u0000${key.message}`
}

function isTranslated(item: ParsedPoItem): boolean {
  return item.msgstr.length > 0 && item.msgstr.every((value) => value.trim().length > 0)
}

function resolveLocales(config: LoadedPalamedesConfig, selectedLocales: string[] | undefined): string[] {
  if (selectedLocales && selectedLocales.length > 0) {
    return normalizeLocaleList(selectedLocales)
  }

  return config.locales.filter(
    (locale) => locale !== config.sourceLocale && locale !== config.pseudoLocale
  )
}

function normalizeLocaleList(values: string[]): string[] {
  return [
    ...new Set(
      values
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    ),
  ]
}

function normalizeThreshold(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error("Invalid --fail-if-below value. Expected a percent from 0 to 100.")
  }

  return parsed
}

function printReport(result: CompletenessReport): void {
  if (result.locales.length === 0) {
    console.log(chalk.gray("No target locales configured."))
    return
  }

  const localeColumnWidth = Math.max(
    "Locale".length,
    ...result.locales.map((locale) => locale.locale.length)
  ) + 2

  console.log(`${"Locale".padEnd(localeColumnWidth)}Translated  Missing  Fuzzy  Complete`)
  for (const locale of result.locales) {
    const complete = locale.percent === 100 ? chalk.green(formatPercent(locale.percent)) : formatPercent(locale.percent)
    console.log(
      `${locale.locale.padEnd(localeColumnWidth)}${`${locale.translated}/${locale.total}`.padEnd(11)} ${String(locale.missing).padEnd(8)} ${String(locale.fuzzy).padEnd(6)} ${complete}`
    )
  }
}

function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`
}
