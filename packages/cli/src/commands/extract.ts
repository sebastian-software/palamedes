import { readFile, mkdir } from "fs/promises"
import path from "path"
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
import { updateCatalogFile, type CatalogUpdateMessage } from "@palamedes/core-node"
import { parseSync } from "oxc-parser"
import { extractMessages } from "@palamedes/extractor"

interface ExtractOptions {
  config?: string
  watch?: boolean
  clean?: boolean
  verbose?: boolean
}

const TIMING_MARKER = "__PALAMEDES_TIMINGS__"

interface AggregatedCatalogEntry {
  message: string
  context?: string
  extractedComments: string[]
  origins: Array<{ file: string; line: number }>
}

type AggregatedCatalog = Record<string, AggregatedCatalogEntry>

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
  let totalMessages = 0
  let totalFiles = 0
  const catalogs = config.catalogs ?? []

  for (const catalog of catalogs) {
    const { messages, fileCount } = await extractFromCatalog(catalog, config, options)
    totalMessages += Object.keys(messages).length
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
): Promise<{ messages: AggregatedCatalog; fileCount: number }> {
  const messages: AggregatedCatalog = {}
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

  const files = await glob(includePatterns, {
    ignore: excludePatterns,
    absolute: true,
    nodir: true,
  })

  if (options.verbose) {
    console.log(chalk.gray(`Found ${files.length} files to extract from`))
  }

  for (const file of files) {
    try {
      const code = await readFile(file, "utf-8")
      const relativePath = path.relative(rootDir, file)
      const result = parseSync(file, code, { sourceType: "module" })

      if (result.errors.length > 0) {
        const errorMessages = result.errors.map((error) => error.message).join(", ")
        throw new Error(`Parse error: ${errorMessages}`)
      }

      const extractedMessages = extractMessages(result.program, file, code)

      for (const msg of extractedMessages) {
        if (!msg.message) {
          continue
        }
        const key = createCatalogKey(msg.message, msg.context)

        if (!messages[key]) {
          messages[key] = {
            message: msg.message,
            context: msg.context,
            extractedComments: msg.comment ? [msg.comment] : [],
            origins: [],
          }
        }

        if (msg.origin) {
          const origin = {
            file: relativePath,
            line: msg.origin[1],
          }
          if (!messages[key].origins.some((entry) => entry.file === origin.file && entry.line === origin.line)) {
            messages[key].origins.push(origin)
          }
        }
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("Explicit message ids are no longer supported")
      ) {
        throw error
      }

      if (options.verbose) {
        console.warn(chalk.yellow("Warning:"), `Failed to extract from ${file}:`, error)
      }
    }
  }

  return { messages, fileCount: files.length }
}

async function writeCatalog(
  catalog: PalamedesCatalogConfig,
  locale: string,
  extractedMessages: AggregatedCatalog,
  config: LoadedPalamedesConfig,
  options: ExtractOptions
): Promise<number> {
  const startedAt = Date.now()
  const catalogPath = resolveCatalogPath(config, catalog.path, locale)
  const poPath = `${catalogPath}.po`

  const dir = path.dirname(poPath)
  await mkdir(dir, { recursive: true })

  updateCatalogFile({
    targetPath: poPath,
    locale,
    sourceLocale: config.sourceLocale,
    clean: Boolean(options.clean),
    messages: catalogToMessages(extractedMessages),
  })

  if (options.verbose) {
    console.log(chalk.gray(`  → ${poPath}`))
  }

  return Date.now() - startedAt
}

async function runWatchMode(
  config: LoadedPalamedesConfig,
  options: ExtractOptions
): Promise<void> {
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

function catalogToMessages(catalog: AggregatedCatalog): CatalogUpdateMessage[] {
  return Object.values(catalog).map((entry) => ({
    message: entry.message,
    context: entry.context,
    extractedComments: entry.extractedComments ?? [],
    origins: (entry.origins ?? []).map((origin) => ({
      file: origin.file,
      line: origin.line ?? 0,
    })),
  }))
}

function createCatalogKey(message: string, context?: string): string {
  return `${context ?? ""}\u0004${message}`
}
