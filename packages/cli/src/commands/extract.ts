import { mkdir } from "node:fs/promises"
import path from "node:path"
import chalk from "chalk"
import { glob } from "glob"
import { watch } from "chokidar"
import {
  loadPalamedesConfig,
  resolveCatalogPath,
  resolveConfigPattern,
  type LoadedPalamedesConfig,
  type PalamedesCatalogConfig,
} from "@palamedes/config"
import {
  extractCatalogMessagesFromFiles,
  updateCatalogFile,
  type CatalogUpdateMessage,
} from "@palamedes/core-node"

type ExtractOptions = {
  config?: string
  watch?: boolean
  clean?: boolean
  verbose?: boolean
}

const TIMING_MARKER = "__PALAMEDES_TIMINGS__"

type CatalogExtractionResult = {
  messages: CatalogUpdateMessage[]
  fileCount: number
  globMs: number
  extractMs: number
}

export async function extract(options: ExtractOptions): Promise<void> {
  const config = await loadPalamedesConfig({ configPath: options.config })

  if (options.verbose) {
    console.log(chalk.gray("Config loaded:"), config.locales)
  }

  if (options.watch) {
    await runWatchMode(config, options)
  } else {
    await runExtraction(config, options)
  }
}

async function runExtraction(
  config: LoadedPalamedesConfig,
  options: ExtractOptions
): Promise<void> {
  const startTime = Date.now()
  let totalWriteMs = 0
  let totalGlobMs = 0
  let totalExtractMs = 0
  let totalMessages = 0
  let totalFiles = 0
  const catalogs = config.catalogs ?? []

  for (const catalog of catalogs) {
    const { messages, fileCount, globMs, extractMs } = await extractFromCatalog(
      catalog,
      config,
      options
    )
    totalGlobMs += globMs
    totalExtractMs += extractMs
    totalMessages += messages.length
    totalFiles += fileCount

    // Write catalogs for each locale
    for (const locale of config.locales) {
      totalWriteMs += await writeCatalog(catalog, locale, messages, config, options)
    }
  }

  const duration = Date.now() - startTime
  console.log(
    chalk.green("✓"),
    `Extracted ${chalk.bold(totalMessages)} messages from ${chalk.bold(totalFiles)} files`,
    chalk.gray(`(${duration}ms)`)
  )

  if (shouldEmitTimingJson()) {
    console.log(
      `${TIMING_MARKER}${JSON.stringify({
        engine: "ferrocat",
        totalMs: duration,
        globMs: totalGlobMs,
        extractMs: totalExtractMs,
        writeMs: totalWriteMs,
        totalMessages,
        totalFiles,
      })}`
    )
  }
}

async function extractFromCatalog(
  catalog: PalamedesCatalogConfig,
  config: LoadedPalamedesConfig,
  options: ExtractOptions
): Promise<CatalogExtractionResult> {
  const rootDir = config.rootDir

  const includePatterns = catalog.include.map((pattern) => {
    const resolved = resolveConfigPattern(config, pattern)
    if (!resolved.includes("*") && !resolved.includes(".")) {
      return `${resolved}/**/*.{js,jsx,ts,tsx}`
    }
    return resolved
  })
  const excludePatterns = catalog.exclude?.map((pattern) =>
    resolveConfigPattern(config, pattern)
  ) || ["**/node_modules/**"]

  const globStartedAt = Date.now()
  const files = (
    await glob(includePatterns, {
      ignore: excludePatterns,
      absolute: true,
      nodir: true,
    })
  ).sort(compareFilePaths)
  const globMs = Date.now() - globStartedAt

  if (options.verbose) {
    console.log(chalk.gray(`Found ${files.length} files to extract from`))
  }

  const extractStartedAt = Date.now()
  const result = extractCatalogMessagesFromFiles({
    rootDir: config.sourceReferenceRoot,
    files,
  })
  const extractMs = Date.now() - extractStartedAt

  if (options.verbose) {
    for (const failure of result.failedFiles) {
      console.warn(
        chalk.yellow("Warning:"),
        `Failed to extract from ${failure.path}:`,
        failure.message
      )
    }
  }

  return {
    messages: result.messages,
    fileCount: result.fileCount,
    globMs,
    extractMs,
  }
}

async function writeCatalog(
  catalog: PalamedesCatalogConfig,
  locale: string,
  extractedMessages: CatalogUpdateMessage[],
  config: LoadedPalamedesConfig,
  options: ExtractOptions
): Promise<number> {
  const startedAt = Date.now()
  const catalogPath = resolveCatalogPath(config, catalog.path, locale)
  const poPath = `${catalogPath}.po`

  const dir = path.dirname(poPath)
  await mkdir(dir, { recursive: true })

  const result = updateCatalogFile({
    targetPath: poPath,
    locale,
    sourceLocale: config.sourceLocale,
    clean: Boolean(options.clean),
    messages: extractedMessages,
  })

  if (options.verbose) {
    console.log(chalk.gray(`  → ${poPath}`))
    for (const diagnostic of result.diagnostics) {
      console.warn(chalk.yellow("Warning:"), `${diagnostic.code}: ${diagnostic.message}`)
    }
  }

  return Date.now() - startedAt
}

async function runWatchMode(config: LoadedPalamedesConfig, options: ExtractOptions): Promise<void> {
  console.log(chalk.cyan("Watching for changes..."))

  // Initial extraction
  await runExtraction(config, options)

  // Watch for changes
  const watchPatterns = (config.catalogs ?? []).flatMap((catalog) =>
    catalog.include.map((pattern) => resolveConfigPattern(config, pattern))
  )

  const watcher = watch(watchPatterns, {
    ignored: ["**/node_modules/**", "**/*.po"],
    persistent: true,
  })

  watcher.on("change", async (file) => {
    console.log(chalk.gray(`File changed: ${file}`))
    await runExtraction(config, options)
  })

  watcher.on("add", async (file) => {
    console.log(chalk.gray(`File added: ${file}`))
    await runExtraction(config, options)
  })

  // Keep process running
  process.on("SIGINT", () => {
    watcher.close()
    process.exit(0)
  })
}

function shouldEmitTimingJson(): boolean {
  return process.env.PALAMEDES_TIMING_JSON === "1"
}

function compareFilePaths(a: string, b: string): number {
  if (a < b) {
    return -1
  }
  if (a > b) {
    return 1
  }
  return 0
}
